#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define SOCKET_PATH "/var/run/yaagl-hosts-helper.sock"
#define HOSTS_PATH "/etc/hosts"
#define HOSTS_BACKUP_PATH "/etc/hosts.yaagl.bak"
#define HOSTS_TEMP_PATH "/etc/hosts.yaagl.tmp"
#define MAX_REQUEST 8192
#define MAX_ENTRIES 64
#define PERM_START "# Added by Yaagl"
#define PERM_WARN "# Warning: any content in this section will be overwritten"
#define PERM_END "# End of section"
#define TEMP_START "# Temporarily Added by Yaagl"
#define TEMP_END "# End of temporary section"

typedef struct {
  char ip[46];
  char domain[256];
} Entry;

static void die(const char *fmt, ...) {
  va_list args;
  va_start(args, fmt);
  vfprintf(stderr, fmt, args);
  va_end(args);
  fputc('\n', stderr);
  exit(1);
}

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
  system("/usr/bin/dscacheutil -flushcache >/dev/null 2>&1");
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

static void delayed_unblock(unsigned int ttl) {
  pid_t pid = fork();
  if (pid != 0) return;
  setsid();
  sleep(ttl);
  unblock_hosts();
  _exit(0);
}

static int parse_entries(char **parts, int start, int total, Entry *entries) {
  int count = atoi(parts[start]);
  if (count < 0 || count > MAX_ENTRIES) die("invalid count");
  if (total < start + 1 + count * 2) die("not enough arguments");
  for (int i = 0; i < count; i++) {
    snprintf(entries[i].ip, sizeof(entries[i].ip), "%s", parts[start + 1 + i * 2]);
    snprintf(entries[i].domain, sizeof(entries[i].domain), "%s", parts[start + 2 + i * 2]);
  }
  validate_entries(entries, count);
  return count;
}

static void handle_request(int fd, char *request) {
  char *parts[140];
  int count = 0;
  char *saveptr = NULL;
  for (char *tok = strtok_r(request, " \t\r\n", &saveptr); tok && count < 140;
       tok = strtok_r(NULL, " \t\r\n", &saveptr)) {
    parts[count++] = tok;
  }
  if (count == 0) die("empty request");

  Entry entries[MAX_ENTRIES];
  if (strcmp(parts[0], "STATUS") == 0) {
    dprintf(fd, "OK running\n");
  } else if (strcmp(parts[0], "ENSURE") == 0) {
    int entry_count = parse_entries(parts, 1, count, entries);
    set_section(PERM_START, PERM_END, true, entries, entry_count);
    dprintf(fd, "OK ensured\n");
  } else if (strcmp(parts[0], "BLOCK") == 0) {
    if (count < 3) die("missing ttl");
    unsigned int ttl = (unsigned int)atoi(parts[1]);
    if (ttl < 1 || ttl > 3600) die("invalid ttl");
    int entry_count = parse_entries(parts, 2, count, entries);
    set_section(TEMP_START, TEMP_END, false, entries, entry_count);
    delayed_unblock(ttl);
    dprintf(fd, "OK blocked\n");
  } else if (strcmp(parts[0], "UNBLOCK") == 0) {
    unblock_hosts();
    dprintf(fd, "OK unblocked\n");
  } else {
    die("unknown command");
  }
}

static void daemon_mode(void) {
  if (geteuid() != 0) die("daemon must run as root");
  signal(SIGCHLD, SIG_IGN);
  unlink(SOCKET_PATH);

  int server = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server < 0) die("socket failed: %s", strerror(errno));

  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", SOCKET_PATH);
  if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) != 0) die("bind failed: %s", strerror(errno));
  chmod(SOCKET_PATH, 0666);
  if (listen(server, 16) != 0) die("listen failed: %s", strerror(errno));

  for (;;) {
    int client = accept(server, NULL, NULL);
    if (client < 0) continue;
    uid_t peer_uid = 0;
    gid_t peer_gid = 0;
    struct stat console_st;
    if (getpeereid(client, &peer_uid, &peer_gid) != 0 ||
        stat("/dev/console", &console_st) != 0 ||
        (peer_uid != 0 && peer_uid != console_st.st_uid)) {
      dprintf(client, "ERR unauthorized\n");
      close(client);
      continue;
    }

    char request[MAX_REQUEST];
    ssize_t n = read(client, request, sizeof(request) - 1);
    if (n > 0) {
      request[n] = '\0';
      pid_t pid = fork();
      if (pid == 0) {
        handle_request(client, request);
        close(client);
        _exit(0);
      }
    }
    close(client);
  }
}

static void client_mode(int argc, char **argv) {
  if (argc < 3) die("missing request action");
  char request[MAX_REQUEST];
  request[0] = '\0';
  if (strcmp(argv[2], "status") == 0) {
    snprintf(request, sizeof(request), "STATUS\n");
  } else if (strcmp(argv[2], "ensure") == 0) {
    if ((argc - 3) % 2 != 0) die("ensure expects ip/domain pairs");
    snprintf(request, sizeof(request), "ENSURE %d", (argc - 3) / 2);
    for (int i = 3; i < argc; i++) {
      strlcat(request, " ", sizeof(request));
      strlcat(request, argv[i], sizeof(request));
    }
    strlcat(request, "\n", sizeof(request));
  } else if (strcmp(argv[2], "block") == 0) {
    if (argc < 6 || (argc - 4) % 2 != 0) die("block expects ttl and ip/domain pairs");
    snprintf(request, sizeof(request), "BLOCK %s %d", argv[3], (argc - 4) / 2);
    for (int i = 4; i < argc; i++) {
      strlcat(request, " ", sizeof(request));
      strlcat(request, argv[i], sizeof(request));
    }
    strlcat(request, "\n", sizeof(request));
  } else if (strcmp(argv[2], "unblock") == 0) {
    snprintf(request, sizeof(request), "UNBLOCK\n");
  } else {
    die("unknown action");
  }

  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) die("socket failed: %s", strerror(errno));
  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", SOCKET_PATH);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) die("connect failed: %s", strerror(errno));
  write(fd, request, strlen(request));
  shutdown(fd, SHUT_WR);

  char response[1024];
  ssize_t n = read(fd, response, sizeof(response) - 1);
  if (n <= 0) die("empty response");
  response[n] = '\0';
  fputs(response, stdout);
  close(fd);
  if (strncmp(response, "OK ", 3) != 0) exit(1);
}

int main(int argc, char **argv) {
  if (argc >= 2 && strcmp(argv[1], "--daemon") == 0) {
    daemon_mode();
    return 0;
  }
  if (argc >= 2 && strcmp(argv[1], "--request") == 0) {
    client_mode(argc, argv);
    return 0;
  }
  fprintf(stderr, "usage: %s --daemon | --request <status|ensure|block|unblock> ...\n", argv[0]);
  return 2;
}
