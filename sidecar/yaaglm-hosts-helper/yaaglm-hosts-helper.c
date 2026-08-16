/*
 * yaaglm-hosts-helper — privileged hosts-file helper for Yaaglm.
 *
 * Implements the R2 hardened protocol described in docs/hosts-helper-security.md:
 * AUTH-authenticated Unix socket daemon, registry-backed identity pinning
 * (SHA-256 of client + ancestor launcher), constant-time token comparison,
 * per-bundle rate limiting, audit logging, and a non-root --self-test.
 */

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>
#include <libproc.h>
#include <CommonCrypto/CommonDigest.h>

#define SOCKET_PATH "/var/run/yaaglm-hosts-helper.sock"
#define REGISTRY_PATH "/var/db/yaaglm-hosts-helper.registry"
#define AUDIT_LOG_PATH "/var/log/yaaglm-hosts-helper.log"
#define HOSTS_PATH "/etc/hosts"
#define HOSTS_BACKUP_PATH "/etc/hosts.yaaglm.bak"
#define HOSTS_TEMP_PATH "/etc/hosts.yaaglm.tmp"
#define MAX_REQUEST 8192
#define MAX_ENTRIES 64
#define MAX_REGISTRY_ROWS 128
#define MAX_HASH_CACHE 128
#define HASH_CACHE_TTL 5
#define MAX_ANCESTORS 4
#define MAX_UNBLOCK_CHILDREN 8
#define RATE_CAPACITY 20
#define RATE_WINDOW 60.0
#define MAX_BUCKETS 64
#define PERM_START "# Added by Yaaglm"
#define PERM_WARN "# Warning: any content in this section will be overwritten"
#define PERM_END "# End of section"
#define TEMP_START "# Temporarily Added by Yaaglm"
#define TEMP_END "# End of temporary section"

typedef struct {
  char ip[46];
  char domain[256];
} Entry;

typedef struct {
  char bundle_id[129];
  char version[65];
  char launcher_sha256[65];
  char client_sha256[65];
  char token[65];
  char token_path[1025];
} RegistryRow;

typedef struct {
  char bundle_id[129];
  char version[65];
  char token[65];
  char cmd[32];
  char *args[140];
  int arg_count;
} AuthRequest;

typedef struct {
  pid_t pid;
  char path[PATH_MAX];
  off_t size;
  time_t mtime;
  ino_t inode;
  char sha256[65];
  time_t computed_at;
} HashCacheEntry;

typedef struct {
  char bundle_id[129];
  double tokens;
  struct timeval last;
} Bucket;

/* ------------------------------------------------------------------ */
/* registry state                                                      */
/* ------------------------------------------------------------------ */
static RegistryRow registry_rows[MAX_REGISTRY_ROWS];
static int registry_row_count = 0;
static bool registry_loaded = false;
static struct stat registry_stat;

/* ------------------------------------------------------------------ */
/* hash cache (pid,path,size,mtime,inode) -> sha256, TTL 5s, cap 128   */
/* ------------------------------------------------------------------ */
static HashCacheEntry hash_cache[MAX_HASH_CACHE];
static int hash_cache_count = 0;

/* ------------------------------------------------------------------ */
/* rate limiting + delayed-unblock children                            */
/* ------------------------------------------------------------------ */
static Bucket buckets[MAX_BUCKETS];
static int bucket_count = 0;

static pid_t unblock_children[MAX_UNBLOCK_CHILDREN];
static int unblock_child_count = 0;

static void die(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  vfprintf(stderr, fmt, args);
  va_end(args);
  fputc('\n', stderr);
  exit(1);
}

/* ------------------------------------------------------------------ */
/* validation helpers                                                  */
/* ------------------------------------------------------------------ */
static bool valid_ip(const char *ip) {
  unsigned char buf[sizeof(struct in6_addr)];
  return inet_pton(AF_INET, ip, buf) == 1 || inet_pton(AF_INET6, ip, buf) == 1;
}

static bool valid_domain(const char *domain) {
  size_t len = strlen(domain);
  if (len == 0 || len > 253) return false;
  if (domain[0] == '-' || domain[len - 1] == '-') return false;
  for (size_t i = 0; i < len; i++) {
    unsigned char c = (unsigned char)domain[i];
    if (isalnum(c) || c == '-' || c == '.') continue;
    return false;
  }
  return strstr(domain, "..") == NULL;
}

static void validate_entries(Entry *entries, int count) {
  if (count < 0 || count > MAX_ENTRIES) die("invalid entry count");
  for (int i = 0; i < count; i++) {
    if (!valid_ip(entries[i].ip)) die("invalid ip");
    if (!valid_domain(entries[i].domain)) die("invalid domain");
  }
}

static bool valid_bundle_id(const char *s) {
  size_t len = strlen(s);
  if (len < 1 || len > 128) return false;
  for (size_t i = 0; i < len; i++) {
    unsigned char c = (unsigned char)s[i];
    if (!(isalnum(c) || c == '.' || c == '-')) return false;
  }
  return true;
}

static bool valid_version(const char *s) {
  size_t len = strlen(s);
  if (len < 1 || len > 64) return false;
  for (size_t i = 0; i < len; i++) {
    unsigned char c = (unsigned char)s[i];
    if (!(isalnum(c) || c == '.' || c == '+' || c == '-')) return false;
  }
  return true;
}

static bool valid_hex64(const char *s) {
  if (strlen(s) != 64) return false;
  for (int i = 0; i < 64; i++) {
    unsigned char c = (unsigned char)s[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  return true;
}

static bool valid_ttl(int ttl) { return ttl >= 1 && ttl <= 3600; }

/* ------------------------------------------------------------------ */
/* file helpers                                                        */
/* ------------------------------------------------------------------ */
static char *read_file(const char *path, size_t *len_out) {
  FILE *fp = fopen(path, "rb");
  if (!fp) die("open %s failed: %s", path, strerror(errno));
  if (fseek(fp, 0, SEEK_END) != 0) die("seek failed");
  long size = ftell(fp);
  if (size < 0) die("tell failed");
  rewind(fp);
  char *buf = calloc((size_t)size + 2, 1);
  if (!buf) die("out of memory");
  size_t read_len = fread(buf, 1, (size_t)size, fp);
  fclose(fp);
  buf[read_len] = '\0';
  if (len_out) *len_out = read_len;
  return buf;
}

static bool line_matches(const char *line, size_t len, const char *marker) {
  size_t marker_len = strlen(marker);
  while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) len--;
  return len == marker_len && strncmp(line, marker, marker_len) == 0;
}

static char *remove_section(const char *content, const char *start_marker,
                            const char *end_marker) {
  size_t cap = strlen(content) + 2;
  char *out = calloc(cap, 1);
  if (!out) die("out of memory");
  size_t out_len = 0;
  bool skipping = false;

  const char *p = content;
  while (*p) {
    const char *line = p;
    const char *next = strchr(p, '\n');
    size_t len = next ? (size_t)(next - line + 1) : strlen(line);

    if (!skipping && line_matches(line, len, start_marker)) {
      skipping = true;
    } else if (skipping &&
               (line_matches(line, len, end_marker) ||
                line_matches(line, len, PERM_END) ||
                line_matches(line, len, TEMP_END))) {
      skipping = false;
    } else if (!skipping) {
      if (out_len + len + 1 > cap) die("internal buffer error");
      memcpy(out + out_len, line, len);
      out_len += len;
      out[out_len] = '\0';
    }

    if (!next) break;
    p = next + 1;
  }
  return out;
}

static void append_line(char **buf, size_t *len, size_t *cap, const char *line) {
  size_t line_len = strlen(line);
  if (*len + line_len + 2 > *cap) {
    *cap = (*cap + line_len + 4096) * 2;
    *buf = realloc(*buf, *cap);
    if (!*buf) die("out of memory");
  }
  memcpy(*buf + *len, line, line_len);
  *len += line_len;
  (*buf)[(*len)++] = '\n';
  (*buf)[*len] = '\0';
}

static void copy_file(const char *src, const char *dst) {
  char *buf = read_file(src, NULL);
  FILE *fp = fopen(dst, "wb");
  if (!fp) die("backup failed: %s", strerror(errno));
  fwrite(buf, 1, strlen(buf), fp);
  fclose(fp);
  free(buf);
}

/* Replaces the former `system("/usr/bin/dscacheutil -flushcache ...")` call.
 * fork + execve with _exit(127) fallback in the child. */
static void flush_dns_cache(void) {
  pid_t pid = fork();
  if (pid == 0) {
    int devnull = open("/dev/null", O_WRONLY);
    if (devnull >= 0) {
      dup2(devnull, STDOUT_FILENO);
      dup2(devnull, STDERR_FILENO);
      if (devnull > STDERR_FILENO) close(devnull);
    }
    char *const argv[] = {"dscacheutil", "-flushcache", NULL};
    execve("/usr/bin/dscacheutil", argv, NULL);
    _exit(127);
  }
  if (pid > 0) {
    int status;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {
    }
  }
}

static void write_hosts(const char *content) {
  copy_file(HOSTS_PATH, HOSTS_BACKUP_PATH);
  FILE *fp = fopen(HOSTS_TEMP_PATH, "wb");
  if (!fp) die("write temp failed: %s", strerror(errno));
  fwrite(content, 1, strlen(content), fp);
  fclose(fp);
  chmod(HOSTS_TEMP_PATH, 0644);
  if (rename(HOSTS_TEMP_PATH, HOSTS_PATH) != 0) {
    unlink(HOSTS_TEMP_PATH);
    die("replace hosts failed: %s", strerror(errno));
  }
  flush_dns_cache();
}

static void set_section(const char *start_marker, const char *end_marker,
                        bool include_warning, Entry *entries, int count) {
  validate_entries(entries, count);
  size_t original_len = 0;
  char *original = read_file(HOSTS_PATH, &original_len);
  char *without_new_end = remove_section(original, start_marker, end_marker);
  char *without_legacy_end = remove_section(without_new_end, start_marker, PERM_END);
  size_t cap = strlen(without_legacy_end) + 4096;
  char *out = calloc(cap, 1);
  if (!out) die("out of memory");
  strcpy(out, without_legacy_end);
  size_t out_len = strlen(out);
  if (out_len > 0 && out[out_len - 1] != '\n') append_line(&out, &out_len, &cap, "");
  while (out_len > 1 && out[out_len - 1] == '\n' && out[out_len - 2] == '\n') out[--out_len] = '\0';

  if (count > 0) {
    append_line(&out, &out_len, &cap, start_marker);
    if (include_warning) append_line(&out, &out_len, &cap, PERM_WARN);
    for (int i = 0; i < count; i++) {
      char line[340];
      snprintf(line, sizeof(line), "%s %s", entries[i].ip, entries[i].domain);
      append_line(&out, &out_len, &cap, line);
    }
    append_line(&out, &out_len, &cap, end_marker);
  }

  write_hosts(out);
  free(original);
  free(without_new_end);
  free(without_legacy_end);
  free(out);
}

static void unblock_hosts(void) {
  Entry none[1];
  set_section(TEMP_START, TEMP_END, false, none, 0);
}

/* Non-fatal entry parsing used by the daemon parent (validation must complete
 * before fork) and by --self-test. Returns entry count or -1 on error. */
static int parse_entries_nf(char **parts, int start, int total, Entry *entries) {
  if (start >= total) return -1;
  int count = atoi(parts[start]);
  if (count < 0 || count > MAX_ENTRIES) return -1;
  if (total < start + 1 + count * 2) return -1;
  for (int i = 0; i < count; i++) {
    snprintf(entries[i].ip, sizeof(entries[i].ip), "%s", parts[start + 1 + i * 2]);
    snprintf(entries[i].domain, sizeof(entries[i].domain), "%s", parts[start + 2 + i * 2]);
  }
  for (int i = 0; i < count; i++) {
    if (!valid_ip(entries[i].ip) || !valid_domain(entries[i].domain)) return -1;
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* registry parsing / reload                                           */
/* ------------------------------------------------------------------ */
/* Returns 1 on success, 0 for comment/empty lines, -1 on malformed. */
static int parse_registry_line(char *line, RegistryRow *row) {
  while (*line == ' ' || *line == '\t') line++;
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == ' ' || line[len - 1] == '\t' || line[len - 1] == '\r')) {
    line[--len] = '\0';
  }
  if (*line == '\0') return 0;
  if (*line == '#') return 0;

  char *fields[16];
  int n = 0;
  char *saveptr = NULL;
  for (char *tok = strtok_r(line, "|", &saveptr); tok != NULL && n < 16;
       tok = strtok_r(NULL, "|", &saveptr)) {
    fields[n++] = tok;
  }
  if (n != 6) return -1;
  if (!valid_bundle_id(fields[0])) return -1;
  if (!valid_version(fields[1])) return -1;
  if (!valid_hex64(fields[2]) || !valid_hex64(fields[3]) || !valid_hex64(fields[4])) return -1;
  if (fields[5][0] != '/' || strlen(fields[5]) > 1024) return -1;

  strlcpy(row->bundle_id, fields[0], sizeof(row->bundle_id));
  strlcpy(row->version, fields[1], sizeof(row->version));
  strlcpy(row->launcher_sha256, fields[2], sizeof(row->launcher_sha256));
  strlcpy(row->client_sha256, fields[3], sizeof(row->client_sha256));
  strlcpy(row->token, fields[4], sizeof(row->token));
  strlcpy(row->token_path, fields[5], sizeof(row->token_path));
  return 1;
}

/* stat the registry before every request; reload when mtime/size changed. */
static void registry_refresh(void) {
  struct stat st;
  if (stat(REGISTRY_PATH, &st) != 0 || st.st_size < 0 || st.st_size > (1 << 20)) {
    registry_row_count = 0;
    registry_loaded = false;
    return;
  }
  if (registry_loaded && st.st_mtime == registry_stat.st_mtime &&
      st.st_size == registry_stat.st_size) {
    return;
  }
  registry_stat = st;
  registry_loaded = true;
  registry_row_count = 0;

  int fd = open(REGISTRY_PATH, O_RDONLY);
  if (fd < 0) return;
  char *content = malloc((size_t)st.st_size + 2);
  if (content == NULL) {
    close(fd);
    return;
  }
  ssize_t n = read(fd, content, (size_t)st.st_size);
  close(fd);
  if (n < 0) {
    free(content);
    return;
  }
  content[n] = '\0';

  char *saveptr = NULL;
  for (char *line = strtok_r(content, "\n", &saveptr);
       line != NULL && registry_row_count < MAX_REGISTRY_ROWS;
       line = strtok_r(NULL, "\n", &saveptr)) {
    RegistryRow row;
    if (parse_registry_line(line, &row) == 1) {
      registry_rows[registry_row_count++] = row;
    }
  }
  free(content);
}

static RegistryRow *registry_find(const char *bundle_id) {
  for (int i = 0; i < registry_row_count; i++) {
    if (strcmp(registry_rows[i].bundle_id, bundle_id) == 0) {
      return &registry_rows[i];
    }
  }
  return NULL;
}

/* ------------------------------------------------------------------ */
/* SHA-256 + hash cache                                                */
/* ------------------------------------------------------------------ */
static bool sha256_file(const char *path, char out[65]) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return false;
  CC_SHA256_CTX ctx;
  CC_SHA256_Init(&ctx);
  unsigned char buf[8192];
  ssize_t n;
  bool ok = true;
  while ((n = read(fd, buf, sizeof(buf))) > 0) {
    CC_SHA256_Update(&ctx, buf, (CC_LONG)n);
  }
  if (n < 0) ok = false;
  close(fd);
  if (!ok) return false;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &ctx);
  for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) {
    snprintf(out + i * 2, 3, "%02x", (unsigned int)digest[i]);
  }
  out[64] = '\0';
  return true;
}

/* Returns cached sha256 in `out` (and returns out) or NULL on failure. */
static char *sha256_cached(pid_t pid, const char *path, char out[65]) {
  struct stat st;
  if (stat(path, &st) != 0) return NULL;
  time_t now = time(NULL);

  for (int i = 0; i < hash_cache_count; i++) {
    HashCacheEntry *e = &hash_cache[i];
    if (e->pid == pid && e->size == st.st_size && e->mtime == st.st_mtime &&
        e->inode == st.st_ino && strcmp(e->path, path) == 0) {
      if (now - e->computed_at <= HASH_CACHE_TTL) {
        strcpy(out, e->sha256);
        return out;
      }
      /* expired: drop this slot by swapping in the last entry */
      *e = hash_cache[--hash_cache_count];
      break;
    }
  }

  char sha[65];
  if (!sha256_file(path, sha)) return NULL;

  HashCacheEntry *e;
  if (hash_cache_count < MAX_HASH_CACHE) {
    e = &hash_cache[hash_cache_count++];
  } else {
    /* capacity reached: evict the oldest entry */
    int oldest = 0;
    for (int i = 1; i < hash_cache_count; i++) {
      if (hash_cache[i].computed_at < hash_cache[oldest].computed_at) oldest = i;
    }
    e = &hash_cache[oldest];
  }
  e->pid = pid;
  strlcpy(e->path, path, sizeof(e->path));
  e->size = st.st_size;
  e->mtime = st.st_mtime;
  e->inode = st.st_ino;
  strcpy(e->sha256, sha);
  e->computed_at = now;

  strcpy(out, sha);
  return out;
}

/* Walk up the ancestor chain (<= MAX_ANCESTORS levels) looking for a process
 * whose file hash equals the registered launcher_sha256. */
static bool ancestor_launcher(pid_t peer_pid, const char *launcher_sha256) {
  pid_t pid = peer_pid;
  for (int i = 0; i < MAX_ANCESTORS; i++) {
    struct proc_bsdinfo info;
    int r = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (r <= 0) return false;
    pid_t ppid = (pid_t)info.pbi_ppid;
    if (ppid <= 1) return false;
    char path[PATH_MAX];
    if (proc_pidpath(ppid, path, sizeof(path)) <= 0) {
      pid = ppid;
      continue;
    }
    char sha[65];
    if (sha256_cached(ppid, path, sha) != NULL && strcmp(sha, launcher_sha256) == 0) {
      return true;
    }
    pid = ppid;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* constant-time token comparison (XOR accumulation; no memcmp)        */
/* ------------------------------------------------------------------ */
static bool ct_equal(const char *a, const char *b, size_t len) {
  unsigned char diff = 0;
  for (size_t i = 0; i < len; i++) {
    diff |= (unsigned char)a[i] ^ (unsigned char)b[i];
  }
  return diff == 0;
}

/* ------------------------------------------------------------------ */
/* AUTH request parsing                                                */
/* ------------------------------------------------------------------ */
static int parse_auth(char *line, AuthRequest *out) {
  char *parts[140];
  int n = 0;
  char *saveptr = NULL;
  for (char *tok = strtok_r(line, " \t\r\n", &saveptr); tok != NULL && n < 140;
       tok = strtok_r(NULL, " \t\r\n", &saveptr)) {
    parts[n++] = tok;
  }
  if (n < 5) return -1;
  if (strcmp(parts[0], "AUTH") != 0) return -1;
  if (!valid_bundle_id(parts[1])) return -1;
  if (!valid_version(parts[2])) return -1;
  if (!valid_hex64(parts[3])) return -1;
  if (strlen(parts[4]) >= sizeof(out->cmd)) return -1;

  strlcpy(out->bundle_id, parts[1], sizeof(out->bundle_id));
  strlcpy(out->version, parts[2], sizeof(out->version));
  strlcpy(out->token, parts[3], sizeof(out->token));
  strlcpy(out->cmd, parts[4], sizeof(out->cmd));
  out->arg_count = n - 5;
  for (int i = 0; i < out->arg_count; i++) out->args[i] = parts[5 + i];
  return 1;
}

/* ------------------------------------------------------------------ */
/* rate limiting                                                       */
/* ------------------------------------------------------------------ */
static bool rate_allow(const char *bundle_id) {
  struct timeval now;
  gettimeofday(&now, NULL);
  for (int i = 0; i < bucket_count; i++) {
    if (strcmp(buckets[i].bundle_id, bundle_id) == 0) {
      double elapsed = (double)(now.tv_sec - buckets[i].last.tv_sec) +
                       (double)(now.tv_usec - buckets[i].last.tv_usec) / 1000000.0;
      if (elapsed < 0) elapsed = 0;
      buckets[i].tokens += elapsed * (RATE_CAPACITY / RATE_WINDOW);
      if (buckets[i].tokens > RATE_CAPACITY) buckets[i].tokens = RATE_CAPACITY;
      buckets[i].last = now;
      if (buckets[i].tokens >= 1.0) {
        buckets[i].tokens -= 1.0;
        return true;
      }
      return false;
    }
  }
  /* new bucket: grant the first request (capacity - 1 remains) */
  int slot;
  if (bucket_count < MAX_BUCKETS) {
    slot = bucket_count++;
  } else {
    slot = 0;
    for (int i = 1; i < bucket_count; i++) {
      if (buckets[i].last.tv_sec < buckets[slot].last.tv_sec ||
          (buckets[i].last.tv_sec == buckets[slot].last.tv_sec &&
           buckets[i].last.tv_usec < buckets[slot].last.tv_usec)) {
        slot = i;
      }
    }
  }
  strlcpy(buckets[slot].bundle_id, bundle_id, sizeof(buckets[slot].bundle_id));
  buckets[slot].tokens = RATE_CAPACITY - 1.0;
  buckets[slot].last = now;
  return true;
}

/* ------------------------------------------------------------------ */
/* delayed unblock children (global cap MAX_UNBLOCK_CHILDREN)          */
/* ------------------------------------------------------------------ */
static void spawn_unblock(unsigned int ttl) {
  pid_t pid = fork();
  if (pid == 0) {
    signal(SIGCHLD, SIG_DFL);
    setsid();
    sleep(ttl);
    unblock_hosts();
    _exit(0);
  }
  if (pid > 0 && unblock_child_count < MAX_UNBLOCK_CHILDREN) {
    unblock_children[unblock_child_count++] = pid;
  }
}

static void sigchld_handler(int sig) {
  (void)sig;
  int status;
  pid_t pid;
  while ((pid = waitpid(-1, &status, WNOHANG)) > 0) {
    for (int i = 0; i < unblock_child_count; i++) {
      if (unblock_children[i] == pid) {
        unblock_children[i] = unblock_children[unblock_child_count - 1];
        unblock_child_count--;
        break;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* audit log                                                           */
/* ------------------------------------------------------------------ */
static void audit_log(uid_t peer_uid, const char *bundle_id, const char *cmd,
                      int entry_count, const char *result) {
  int fd = open(AUDIT_LOG_PATH, O_WRONLY | O_APPEND | O_CREAT, 0600);
  if (fd < 0) return;
  (void)fchmod(fd, 0600);
  char ts[64];
  time_t now = time(NULL);
  struct tm tm;
  localtime_r(&now, &tm);
  strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%S%z", &tm);
  dprintf(fd, "%s %d %s %s %d %s\n", ts, (int)peer_uid, bundle_id, cmd, entry_count, result);
  close(fd);
}

static void respond_err(int client, uid_t peer_uid, const char *err, const char *bundle_id,
                        const char *cmd, int entry_count) {
  dprintf(client, "%s\n", err);
  audit_log(peer_uid, bundle_id, cmd, entry_count, err);
  close(client);
}

/* ------------------------------------------------------------------ */
/* request handling (all validation happens here, in the daemon parent, */
/* before any fork so hash cache / rate-limit state survives)          */
/* ------------------------------------------------------------------ */
static void handle_connection(int client) {
  uid_t peer_uid = 0;
  gid_t peer_gid = 0;
  struct stat console_st;
  if (getpeereid(client, &peer_uid, &peer_gid) != 0 ||
      stat("/dev/console", &console_st) != 0 ||
      (peer_uid != 0 && peer_uid != console_st.st_uid)) {
    respond_err(client, (uid_t)-1, "ERR_UNAUTHORIZED", "-", "-", 0);
    return;
  }

  char request[MAX_REQUEST];
  size_t total = 0;
  for (;;) {
    if (total >= sizeof(request) - 1) break;
    ssize_t n = read(client, request + total, sizeof(request) - 1 - total);
    if (n <= 0) break;
    total += (size_t)n;
    if (request[total - 1] == '\n') break;
  }
  request[total] = '\0';
  if (total == 0 || request[total - 1] != '\n') {
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", "-", "-", 0);
    return;
  }
  request[total - 1] = '\0'; /* strip trailing newline */

  AuthRequest auth;
  memset(&auth, 0, sizeof(auth));
  if (parse_auth(request, &auth) != 1) {
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", "-", "-", 0);
    return;
  }
  if (!(strcmp(auth.cmd, "STATUS") == 0 || strcmp(auth.cmd, "ENSURE") == 0 ||
        strcmp(auth.cmd, "BLOCK") == 0 || strcmp(auth.cmd, "UNBLOCK") == 0)) {
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
    return;
  }

  registry_refresh();
  RegistryRow *row = registry_find(auth.bundle_id);
  if (row == NULL) {
    respond_err(client, peer_uid, "ERR_UNREGISTERED", auth.bundle_id, auth.cmd, 0);
    return;
  }

  /* identity: peer pid + file hash, ancestor chain */
  bool hash_fail = false;
  pid_t peer_pid = 0;
  socklen_t plen = sizeof(peer_pid);
  if (getsockopt(client, SOL_LOCAL, LOCAL_PEERPID, &peer_pid, &plen) != 0 || peer_pid <= 1) {
    hash_fail = true;
  } else {
    char peer_path[PATH_MAX];
    if (proc_pidpath(peer_pid, peer_path, sizeof(peer_path)) <= 0) {
      hash_fail = true;
    } else {
      char peer_sha[65];
      if (sha256_cached(peer_pid, peer_path, peer_sha) == NULL ||
          strcmp(peer_sha, row->client_sha256) != 0) {
        hash_fail = true;
      } else if (!ancestor_launcher(peer_pid, row->launcher_sha256)) {
        hash_fail = true;
      }
    }
  }

  /* constant-time token comparison */
  if (!ct_equal(auth.token, row->token, 64)) {
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
    return;
  }

  /* version rules */
  if (hash_fail) {
    if (strcmp(auth.version, row->version) == 0) {
      respond_err(client, peer_uid, "ERR_TAMPERED", auth.bundle_id, auth.cmd, 0);
    } else {
      respond_err(client, peer_uid, "ERR_VERSION_MISMATCH", auth.bundle_id, auth.cmd, 0);
    }
    return;
  }

  /* rate limiting */
  if (!rate_allow(auth.bundle_id)) {
    respond_err(client, peer_uid, "ERR_RATE_LIMITED", auth.bundle_id, auth.cmd, 0);
    return;
  }

  /* command arg / entry / TTL validation (same semantics as before) */
  int ttl = 0;
  Entry entries[MAX_ENTRIES];
  int entry_count = 0;
  if (strcmp(auth.cmd, "ENSURE") == 0) {
    if (auth.arg_count < 1 ||
        (entry_count = parse_entries_nf(auth.args, 0, auth.arg_count, entries)) < 0) {
      respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
      return;
    }
  } else if (strcmp(auth.cmd, "BLOCK") == 0) {
    if (auth.arg_count < 2) {
      respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
      return;
    }
    ttl = atoi(auth.args[0]);
    if (!valid_ttl(ttl)) {
      respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
      return;
    }
    if (unblock_child_count >= MAX_UNBLOCK_CHILDREN) {
      respond_err(client, peer_uid, "ERR_RATE_LIMITED", auth.bundle_id, auth.cmd, 0);
      return;
    }
    if ((entry_count = parse_entries_nf(auth.args, 1, auth.arg_count, entries)) < 0) {
      respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
      return;
    }
  } else if (auth.arg_count != 0) { /* STATUS / UNBLOCK take no args */
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, 0);
    return;
  }

  /* execute in a worker child; for BLOCK the parent spawns the delayed
   * unblock child only after the hosts file was successfully written. */
  bool want_pipe = strcmp(auth.cmd, "BLOCK") == 0;
  int pipefd[2] = {-1, -1};
  if (want_pipe && pipe(pipefd) != 0) want_pipe = false;

  pid_t pid = fork();
  if (pid < 0) {
    if (want_pipe) {
      close(pipefd[0]);
      close(pipefd[1]);
    }
    respond_err(client, peer_uid, "ERR_UNAUTHORIZED", auth.bundle_id, auth.cmd, entry_count);
    return;
  }
  if (pid == 0) {
    signal(SIGCHLD, SIG_DFL);
    if (want_pipe) close(pipefd[0]);
    if (strcmp(auth.cmd, "STATUS") == 0) {
      dprintf(client, "OK %s\n", row->version);
    } else if (strcmp(auth.cmd, "ENSURE") == 0) {
      set_section(PERM_START, PERM_END, true, entries, entry_count);
      dprintf(client, "OK ensured\n");
    } else if (strcmp(auth.cmd, "BLOCK") == 0) {
      set_section(TEMP_START, TEMP_END, false, entries, entry_count);
      if (want_pipe) {
        ssize_t w = write(pipefd[1], "1", 1);
        (void)w;
        close(pipefd[1]);
      }
      dprintf(client, "OK blocked\n");
    } else if (strcmp(auth.cmd, "UNBLOCK") == 0) {
      unblock_hosts();
      dprintf(client, "OK unblocked\n");
    }
    close(client);
    _exit(0);
  }

  /* parent */
  if (want_pipe) {
    close(pipefd[1]);
    char byte;
    ssize_t r = read(pipefd[0], &byte, 1);
    close(pipefd[0]);
    if (r == 1 && unblock_child_count < MAX_UNBLOCK_CHILDREN) {
      spawn_unblock((unsigned int)ttl);
    }
  }
  audit_log(peer_uid, auth.bundle_id, auth.cmd, entry_count, "OK");
  close(client);
}

static void daemon_mode(void) {
  if (geteuid() != 0) die("daemon must run as root");

  struct sigaction sa;
  memset(&sa, 0, sizeof(sa));
  sa.sa_handler = sigchld_handler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_RESTART;
  sigaction(SIGCHLD, &sa, NULL);

  unlink(SOCKET_PATH);
  int server = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server < 0) die("socket failed: %s", strerror(errno));

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", SOCKET_PATH);
  if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    die("bind failed: %s", strerror(errno));
  }
  chmod(SOCKET_PATH, 0666);
  if (listen(server, 16) != 0) die("listen failed: %s", strerror(errno));

  for (;;) {
    int client = accept(server, NULL, NULL);
    if (client < 0) continue;
    /* A stalled client must not block the single-threaded daemon (DoS
     * hardening): fail reads after 5s so the connection is closed and the
     * accept loop can serve the next peer. */
    struct timeval rcv_timeout;
    rcv_timeout.tv_sec = 5;
    rcv_timeout.tv_usec = 0;
    (void)setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &rcv_timeout,
                     sizeof(rcv_timeout));
    handle_connection(client);
  }
}

/* ------------------------------------------------------------------ */
/* client mode                                                         */
/* ------------------------------------------------------------------ */
static int read_token(const char *path, char *out, size_t out_sz) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) return -1;
  char buf[8192];
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  close(fd);
  if (n <= 0) return -1;
  buf[n] = '\0';
  char *line = strtok(buf, "\n"); /* first non-empty line */
  if (line == NULL) return -1;
  while (*line == ' ' || *line == '\t' || *line == '\r') line++;
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == ' ' || line[len - 1] == '\t' || line[len - 1] == '\r')) {
    line[--len] = '\0';
  }
  if (len == 0 || len + 1 > out_sz) return -1;
  memcpy(out, line, len + 1);
  return 0;
}

static int client_mode(int argc, char **argv) {
  if (argc < 5) {
    die("usage: %s --request <bundle_id> <version> <action> [args...] --token-file <path>",
        argv[0]);
  }
  const char *bundle_id = argv[2];
  const char *version = argv[3];
  const char *action = argv[4];

  int tokenfile_idx = -1;
  for (int i = 5; i < argc; i++) {
    if (strcmp(argv[i], "--token-file") == 0) {
      if (i + 1 >= argc) die("missing path after --token-file");
      tokenfile_idx = i;
      break;
    }
  }
  if (tokenfile_idx < 0) die("missing --token-file");
  const char *token_path = argv[tokenfile_idx + 1];
  int n_args = tokenfile_idx - 5;
  if (n_args < 0) die("unexpected arguments before action args");

  char token[128];
  if (read_token(token_path, token, sizeof(token)) != 0) {
    die("cannot read token file: %s", token_path);
  }

  char request[MAX_REQUEST];
  request[0] = '\0';
  if (strcmp(action, "status") == 0 || strcmp(action, "unblock") == 0) {
    if (n_args != 0) die("action %s takes no arguments", action);
    snprintf(request, sizeof(request), "AUTH %s %s %s %s\n", bundle_id, version, token,
             strcmp(action, "status") == 0 ? "STATUS" : "UNBLOCK");
  } else if (strcmp(action, "ensure") == 0) {
    if (n_args % 2 != 0) die("ensure expects ip/domain pairs");
    snprintf(request, sizeof(request), "AUTH %s %s %s ENSURE %d", bundle_id, version, token,
             n_args / 2);
    for (int i = 0; i < n_args; i++) {
      strlcat(request, " ", sizeof(request));
      strlcat(request, argv[5 + i], sizeof(request));
    }
    strlcat(request, "\n", sizeof(request));
  } else if (strcmp(action, "block") == 0) {
    if (n_args < 3 || (n_args - 1) % 2 != 0) die("block expects ttl and ip/domain pairs");
    snprintf(request, sizeof(request), "AUTH %s %s %s BLOCK %s %d", bundle_id, version, token,
             argv[5], (n_args - 1) / 2);
    for (int i = 1; i < n_args; i++) {
      strlcat(request, " ", sizeof(request));
      strlcat(request, argv[5 + i], sizeof(request));
    }
    strlcat(request, "\n", sizeof(request));
  } else {
    die("unknown action: %s", action);
  }

  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) die("socket failed: %s", strerror(errno));
  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", SOCKET_PATH);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    close(fd);
    die("connect failed: %s", strerror(errno));
  }
  ssize_t w = write(fd, request, strlen(request));
  (void)w;
  shutdown(fd, SHUT_WR);

  char response[1024];
  ssize_t n = read(fd, response, sizeof(response) - 1);
  if (n <= 0) die("empty response");
  response[n] = '\0';
  fputs(response, stdout);
  close(fd);

  if (strncmp(response, "OK", 2) == 0) return 0;
  if (strstr(response, "UNREGISTERED") != NULL) return 10;
  if (strstr(response, "VERSION_MISMATCH") != NULL) return 11;
  if (strstr(response, "TAMPERED") != NULL) return 12;
  if (strstr(response, "UNAUTHORIZED") != NULL) return 13;
  if (strstr(response, "RATE_LIMITED") != NULL) return 14;
  return 1;
}

/* ------------------------------------------------------------------ */
/* self-test (non-root)                                                */
/* ------------------------------------------------------------------ */
static int self_test(void) {
  int failures = 0;
#define CHECK(name, cond)                                                      \
  do {                                                                         \
    if (cond) {                                                                \
      printf("PASS %s\n", name);                                               \
    } else {                                                                   \
      printf("FAIL %s\n", name);                                               \
      failures++;                                                              \
    }                                                                          \
  } while (0)

  /* valid_ip boundaries */
  CHECK("ip_v4_loopback", valid_ip("127.0.0.1"));
  CHECK("ip_v4_max", valid_ip("255.255.255.255"));
  CHECK("ip_v4_min", valid_ip("0.0.0.0"));
  CHECK("ip_v4_octet_overflow", !valid_ip("256.1.1.1"));
  CHECK("ip_v4_short", !valid_ip("1.2.3"));
  CHECK("ip_v4_long", !valid_ip("1.2.3.4.5"));
  CHECK("ip_v4_empty", !valid_ip(""));
  CHECK("ip_v4_alpha", !valid_ip("a.b.c.d"));
  CHECK("ip_v4_trailing_space", !valid_ip("1.2.3.4 "));
  CHECK("ip_v6_loopback", valid_ip("::1"));
  CHECK("ip_v6_mapped", valid_ip("::ffff:1.2.3.4"));
  CHECK("ip_v6_bad_hex", !valid_ip("::zz"));
  CHECK("ip_v6_double_scope", !valid_ip("1::2::3"));

  /* valid_domain boundaries */
  CHECK("domain_valid", valid_domain("example.com"));
  CHECK("domain_single_label", valid_domain("localhost"));
  CHECK("domain_inner_hyphen", valid_domain("my-site.example.com"));
  CHECK("domain_digit_start", valid_domain("1example.com"));
  CHECK("domain_leading_hyphen", !valid_domain("-example.com"));
  CHECK("domain_whole_trailing_hyphen", !valid_domain("example.com-"));
  CHECK("domain_label_trailing_hyphen_allowed", valid_domain("example-.com"));
  CHECK("domain_double_dot", !valid_domain("example..com"));
  CHECK("domain_space", !valid_domain("exa mple.com"));
  CHECK("domain_slash", !valid_domain("example.com/path"));
  CHECK("domain_empty", !valid_domain(""));
  {
    char d[255];
    memset(d, 'a', 253);
    d[253] = '\0';
    CHECK("domain_max_len", valid_domain(d));
    memset(d, 'a', 254);
    d[254] = '\0';
    CHECK("domain_too_long", !valid_domain(d));
  }

  /* parse_entries count boundaries */
  {
    Entry entries[MAX_ENTRIES];
    char *p0[] = {"0"};
    CHECK("entries_count_zero", parse_entries_nf(p0, 0, 1, entries) == 0);
    char *p1[] = {"1", "1.2.3.4", "example.com"};
    CHECK("entries_count_one", parse_entries_nf(p1, 0, 3, entries) == 1);
    char *p64[129];
    p64[0] = "64";
    for (int i = 0; i < 64; i++) {
      p64[1 + i * 2] = "1.2.3.4";
      p64[2 + i * 2] = "a.com";
    }
    CHECK("entries_count_max", parse_entries_nf(p64, 0, 129, entries) == 64);
    char *p_neg[] = {"-1"};
    CHECK("entries_count_negative", parse_entries_nf(p_neg, 0, 1, entries) == -1);
    char *p65[] = {"65"};
    CHECK("entries_count_overflow", parse_entries_nf(p65, 0, 1, entries) == -1);
    char *p_short[] = {"1", "1.2.3.4"};
    CHECK("entries_not_enough_args", parse_entries_nf(p_short, 0, 2, entries) == -1);
    char *p_bad_ip[] = {"1", "999.1.1.1", "a.com"};
    CHECK("entries_bad_ip", parse_entries_nf(p_bad_ip, 0, 3, entries) == -1);
    char *p_bad_domain[] = {"1", "1.2.3.4", "bad..com"};
    CHECK("entries_bad_domain", parse_entries_nf(p_bad_domain, 0, 3, entries) == -1);
    char *p_block[6] = {"60", "2", "1.2.3.4", "a.com", "5.6.7.8", "b.com"};
    CHECK("entries_block_shape", parse_entries_nf(p_block, 1, 6, entries) == 2);
    char *p_block_short[5] = {"60", "2", "1.2.3.4", "a.com", "5.6.7.8"};
    CHECK("entries_block_short", parse_entries_nf(p_block_short, 1, 5, entries) == -1);
  }

  /* TTL boundaries */
  CHECK("ttl_min", valid_ttl(1));
  CHECK("ttl_max", valid_ttl(3600));
  CHECK("ttl_zero", !valid_ttl(0));
  CHECK("ttl_over_max", !valid_ttl(3601));
  CHECK("ttl_negative", !valid_ttl(-5));

  /* registry line parsing */
  {
    char hex_a[65], hex_b[65], hex_c[65], hex_upper[65];
    memset(hex_a, 'a', 64);
    hex_a[64] = '\0';
    memset(hex_b, 'b', 64);
    hex_b[64] = '\0';
    memset(hex_c, 'c', 64);
    hex_c[64] = '\0';
    memset(hex_upper, 'A', 64);
    hex_upper[64] = '\0';
    char line[2048];
    RegistryRow row;

    snprintf(line, sizeof(line), "com.3shain.yaaglm.cn|1.0.0|%s|%s|%s|/Users/x/token.t",
             hex_a, hex_b, hex_c);
    CHECK("registry_valid", parse_registry_line(line, &row) == 1);
    CHECK("registry_bundle", strcmp(row.bundle_id, "com.3shain.yaaglm.cn") == 0);
    CHECK("registry_version", strcmp(row.version, "1.0.0") == 0);
    CHECK("registry_client_sha", strcmp(row.client_sha256, hex_b) == 0);
    CHECK("registry_token", strcmp(row.token, hex_c) == 0);

    char comment[] = "  # a comment line";
    CHECK("registry_comment", parse_registry_line(comment, &row) == 0);
    char empty[] = "   ";
    CHECK("registry_empty", parse_registry_line(empty, &row) == 0);

    char f5[2048];
    snprintf(f5, sizeof(f5), "com.ok|1.0.0|%s|%s|%s", hex_a, hex_b, hex_c);
    CHECK("registry_five_fields", parse_registry_line(f5, &row) == -1);
    char f7[2048];
    snprintf(f7, sizeof(f7), "com.ok|1.0.0|%s|%s|%s|/x|extra", hex_a, hex_b, hex_c);
    CHECK("registry_seven_fields", parse_registry_line(f7, &row) == -1);

    char bad_bundle[2048];
    snprintf(bad_bundle, sizeof(bad_bundle), "com/bad|1.0.0|%s|%s|%s|/x", hex_a, hex_b, hex_c);
    CHECK("registry_bad_bundle", parse_registry_line(bad_bundle, &row) == -1);
    char bad_version[2048];
    snprintf(bad_version, sizeof(bad_version), "com.ok|1.0.0_|%s|%s|%s|/x", hex_a, hex_b, hex_c);
    CHECK("registry_bad_version", parse_registry_line(bad_version, &row) == -1);
    char upper_sha[2048];
    snprintf(upper_sha, sizeof(upper_sha), "com.ok|1.0.0|%s|%s|%s|/x", hex_upper, hex_b, hex_c);
    CHECK("registry_upper_sha", parse_registry_line(upper_sha, &row) == -1);
    char short_sha[2048];
    snprintf(short_sha, sizeof(short_sha), "com.ok|1.0.0|%s|%s|%s|/x", hex_a, hex_b, "nothex64");
    CHECK("registry_short_sha", parse_registry_line(short_sha, &row) == -1);
    char bad_token[2048];
    snprintf(bad_token, sizeof(bad_token), "com.ok|1.0.0|%s|%s|nothex|/x", hex_a, hex_b);
    CHECK("registry_bad_token", parse_registry_line(bad_token, &row) == -1);
    char rel_path[2048];
    snprintf(rel_path, sizeof(rel_path), "com.ok|1.0.0|%s|%s|%s|relative", hex_a, hex_b, hex_c);
    CHECK("registry_relative_path", parse_registry_line(rel_path, &row) == -1);
  }

  /* constant-time comparison */
  {
    const char *a = "0123456789abcdef0123456789abcdef";
    const char *same = "0123456789abcdef0123456789abcdef";
    const char *diff_first = "1123456789abcdef0123456789abcdef";
    const char *diff_mid = "0123456789abcdef1123456789abcdef";
    const char *diff_last = "0123456789abcdef0123456789abcdeF";
    CHECK("ct_equal_same", ct_equal(a, same, 32));
    CHECK("ct_equal_diff_first", !ct_equal(a, diff_first, 32));
    CHECK("ct_equal_diff_mid", !ct_equal(a, diff_mid, 32));
    CHECK("ct_equal_diff_last", !ct_equal(a, diff_last, 32));
    CHECK("ct_equal_zero_len", ct_equal("", "", 0));
  }

  /* AUTH header parsing */
  {
    char hex[65];
    memset(hex, 'c', 64);
    hex[64] = '\0';
    AuthRequest ar;

    char l_status[1024];
    snprintf(l_status, sizeof(l_status), "AUTH com.3shain.yaaglm.cn 1.0.0 %s STATUS", hex);
    CHECK("auth_status", parse_auth(l_status, &ar) == 1);
    CHECK("auth_cmd", strcmp(ar.cmd, "STATUS") == 0);
    CHECK("auth_bundle", strcmp(ar.bundle_id, "com.3shain.yaaglm.cn") == 0);
    CHECK("auth_version", strcmp(ar.version, "1.0.0") == 0);
    CHECK("auth_token", strcmp(ar.token, hex) == 0);

    char l_ensure[1024];
    snprintf(l_ensure, sizeof(l_ensure),
             "AUTH com.3shain.yaaglm.cn 1.0.0 %s ENSURE 1 1.2.3.4 a.com", hex);
    CHECK("auth_ensure", parse_auth(l_ensure, &ar) == 1);
    CHECK("auth_ensure_args", ar.arg_count == 3 && strcmp(ar.args[0], "1") == 0);

    char l_no_prefix[] = "STATUS";
    CHECK("auth_missing_prefix", parse_auth(l_no_prefix, &ar) == -1);
    char l_no_cmd[] = "AUTH b v t";
    CHECK("auth_missing_cmd", parse_auth(l_no_cmd, &ar) == -1);
    char l_bad_bundle[] = "AUTH bad/bundle v t CMD";
    CHECK("auth_bad_bundle", parse_auth(l_bad_bundle, &ar) == -1);
    char l_bad_version[] = "AUTH b v_ t CMD";
    CHECK("auth_bad_version", parse_auth(l_bad_version, &ar) == -1);
    char l_bad_token[] = "AUTH b v nothex CMD";
    CHECK("auth_bad_token", parse_auth(l_bad_token, &ar) == -1);
    char l_trailing_nl[1024];
    snprintf(l_trailing_nl, sizeof(l_trailing_nl), "AUTH com.3shain.yaaglm.cn 1.0.0 %s CMD\n", hex);
    CHECK("auth_trailing_newline", parse_auth(l_trailing_nl, &ar) == 1);
  }

#undef CHECK
  return failures ? 1 : 0;
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "--daemon") == 0) {
    daemon_mode();
    return 0;
  }
  if (argc >= 2 && strcmp(argv[1], "--self-test") == 0) {
    return self_test();
  }
  if (argc >= 2 && strcmp(argv[1], "--request") == 0) {
    return client_mode(argc, argv);
  }
  fprintf(stderr,
          "usage: %s --daemon | --self-test | --request <bundle_id> <version> "
          "<status|ensure|block|unblock> [args...] --token-file <path>\n",
          argv[0]);
  return 2;
}
