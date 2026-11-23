import {
  For,
  Index,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { Skeleton } from "@hope-ui/solid";
import { AppModal } from "@src/components/app-modal";
import type { ChannelClient } from "../../../channel-client";
import type { HoyoConnectSocialMedia } from "../../../clients/mhy/launcher-info";
import { GameBanner } from "../../components/game-banner";
import { open } from "@platform/neutralino";
import "./mhy.css";

const BANNER_INTERVAL_MS = 10000;
const HIDDEN_SOCIAL_MEDIA_TITLE = "启动器常见问题答疑";

function openLink(link: string | undefined) {
  if (!link) return;
  void open(link);
}

function getSocialLink(social: HoyoConnectSocialMedia) {
  return (
    social.links.find(link => link.link)?.link || social.icon.link || undefined
  );
}

function getSocialTitle(social: HoyoConnectSocialMedia) {
  return (
    social.links.find(link => link.link)?.title ||
    social.qr_desc ||
    social.red_dot_content ||
    "社交媒体"
  );
}

type HomeTool = {
  kind: "pulls" | "check-in";
  title: string;
  status: string;
  disabled: boolean;
  open: () => void;
};

export function MhyClientView(props: {
  client: ChannelClient;
  channelName?: string;
  announcements?: {
    title: string;
    loading: string;
    empty: string;
    count: (count: number) => string;
  };
  communityTools?: readonly HomeTool[];
}) {
  const launcherIconButtons = createMemo(
    () => props.client.uiContent.launcherIconButtons ?? []
  );
  const launcherIconButton = createMemo(() => launcherIconButtons()[0]);
  const banners = createMemo(() => props.client.uiContent.banners ?? []);
  const posts = createMemo(() => props.client.uiContent.posts ?? []);
  const socialMedia = createMemo(() =>
    (props.client.uiContent.social_media_list ?? []).filter(social => {
      const hasHiddenLink = social.links.some(
        link => link.title === HIDDEN_SOCIAL_MEDIA_TITLE
      );
      const hasSocialLink = Boolean(getSocialLink(social));
      const hasQrImage = Boolean(social.qr_image?.url);
      return !hasHiddenLink && (hasSocialLink || hasQrImage);
    })
  );
  const [bannerIndex, setBannerIndex] = createSignal(0);
  const [announcementsOpen, setAnnouncementsOpen] = createSignal(false);
  const hasTools = () => Boolean(props.communityTools?.length);
  createEffect(
    on(
      () => props.client,
      () => setAnnouncementsOpen(false)
    )
  );
  const [launcherIconHovered, setLauncherIconHovered] = createSignal(false);

  createEffect(() => {
    const count = banners().length;
    if (count === 0) {
      setBannerIndex(0);
    } else if (bannerIndex() >= count) {
      setBannerIndex(0);
    }
  });

  createEffect(() => {
    if (banners().length < 2) return;
    const timer = window.setInterval(() => {
      setBannerIndex(index => (index + 1) % banners().length);
    }, BANNER_INTERVAL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  const currentBanner = createMemo(() => banners()[bannerIndex()]);
  const bannerFallbackLabel = () =>
    props.client.uiContent.channelName ?? props.channelName ?? "";
  const recentPosts = createMemo(() => posts().slice(0, 3));
  const contentPending = createMemo(
    () => props.client.uiContent.launcherContentLoaded === false
  );
  const hasContent = createMemo(
    () =>
      launcherIconButtons().length > 0 ||
      banners().length > 0 ||
      recentPosts().length > 0 ||
      socialMedia().length > 0
  );

  const showLauncherContent = () =>
    !props.client.uiContent.channelName && (hasContent() || contentPending());

  const announcementTitle = () => props.announcements?.title ?? "近期公告";
  const announcementEmpty = () => props.announcements?.empty ?? "暂无近期公告";
  const announcementStatus = () => {
    if (!showLauncherContent()) return announcementEmpty();
    const total = recentPosts().length;
    if (total) return props.announcements?.count(total) ?? `${total} 条公告`;
    return contentPending()
      ? props.announcements?.loading ?? "加载中…"
      : announcementEmpty();
  };

  const featuredAnnouncement = () =>
    showLauncherContent() ? recentPosts()[0] : undefined;

  function AnnouncementPosts() {
    return (
      <div class="hyp-mhy-posts">
        <Show
          when={recentPosts().length}
          fallback={
            <Show
              when={contentPending()}
              fallback={<p>{announcementEmpty()}</p>}
            >
              <For each={[0, 1, 2]}>
                {_ => (
                  <div class="hyp-mhy-post hyp-mhy-post-skeleton">
                    <Skeleton class="hyp-mhy-post-title-skeleton" />
                    <Skeleton class="hyp-mhy-post-date-skeleton" />
                  </div>
                )}
              </For>
            </Show>
          }
        >
          <For each={recentPosts()}>
            {post => (
              <button
                type="button"
                class="hyp-mhy-post"
                onClick={() => openLink(post.link)}
                disabled={!post.link}
              >
                <span>{post.title}</span>
                <time>{post.date}</time>
              </button>
            )}
          </For>
        </Show>
      </div>
    );
  }

  function moveBanner(offset: number) {
    const count = banners().length;
    if (count < 2) return;
    setBannerIndex(index => (index + offset + count) % count);
  }

  return (
    <Show when={showLauncherContent() || hasTools()}>
      <div class="hyp-mhy-content">
        <Show when={showLauncherContent() && socialMedia().length > 0}>
          <aside class="hyp-mhy-social" aria-label="社交媒体">
            <For each={socialMedia()}>
              {social => {
                const socialLink = () => getSocialLink(social);
                const socialTitle = () => getSocialTitle(social);
                return (
                  <div class="hyp-mhy-social-item-wrap">
                    <Show when={social.qr_image?.url}>
                      <div
                        class="hyp-mhy-qr-popover"
                        role="tooltip"
                        aria-label={social.qr_desc || "二维码"}
                      >
                        <img
                          src={social.qr_image!.url}
                          alt={social.qr_desc || "二维码"}
                          loading="lazy"
                          decoding="async"
                        />
                        <Show when={social.qr_desc}>
                          <span>{social.qr_desc}</span>
                        </Show>
                      </div>
                    </Show>
                    <button
                      type="button"
                      class="hyp-mhy-social-item"
                      aria-label={socialTitle()}
                      title={socialTitle()}
                      onClick={() => openLink(socialLink())}
                    >
                      <img
                        src={social.icon.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <Show when={social.enable_red_dot}>
                        <span class="hyp-mhy-social-dot" aria-hidden="true" />
                      </Show>
                    </button>
                  </div>
                );
              }}
            </For>
          </aside>
        </Show>

        <div
          classList={{
            "hyp-mhy-board-stack": true,
            "hyp-mhy-board-stack--with-tools": hasTools(),
          }}
        >
          <Show when={showLauncherContent() && launcherIconButton()}>
            {iconButton => {
              const imageUrl = () =>
                launcherIconHovered() && iconButton().hover_url
                  ? iconButton().hover_url!
                  : iconButton().url;
              return (
                <button
                  type="button"
                  class="hyp-mhy-icon-button"
                  aria-label="活动入口"
                  title="活动入口"
                  onClick={() => openLink(iconButton().link)}
                  onMouseEnter={() => setLauncherIconHovered(true)}
                  onMouseLeave={() => setLauncherIconHovered(false)}
                  onFocus={() => setLauncherIconHovered(true)}
                  onBlur={() => setLauncherIconHovered(false)}
                  disabled={!iconButton().link}
                >
                  <img src={imageUrl()} alt="" />
                </button>
              );
            }}
          </Show>

          <div class="hyp-mhy-home-panel">
            <Show
              when={
                showLauncherContent() &&
                (currentBanner() ||
                  (!hasTools() && recentPosts().length > 0) ||
                  contentPending())
              }
            >
              <section class="hyp-mhy-board" aria-label="公告板">
                <Show
                  when={currentBanner()}
                  fallback={
                    <Show when={contentPending()}>
                      <div class="hyp-mhy-banner-wrap">
                        <Skeleton class="hyp-mhy-banner-skeleton" />
                      </div>
                    </Show>
                  }
                >
                  {banner => (
                    <div class="hyp-mhy-banner-wrap">
                      <button
                        type="button"
                        class="hyp-mhy-banner"
                        onClick={() => openLink(banner().image.link)}
                        disabled={!banner().image.link}
                      >
                        <GameBanner
                          src={banner().image.url}
                          label={bannerFallbackLabel()}
                          loading={bannerIndex() === 0 ? "eager" : "lazy"}
                        />
                      </button>
                      <Show when={banners().length > 1}>
                        <div class="hyp-mhy-banner-arrows" aria-hidden="false">
                          <button
                            type="button"
                            aria-label="上一张 Banner"
                            onClick={() => moveBanner(-1)}
                          >
                            ‹
                          </button>
                          <button
                            type="button"
                            aria-label="下一张 Banner"
                            onClick={() => moveBanner(1)}
                          >
                            ›
                          </button>
                        </div>
                        <div
                          class="hyp-mhy-banner-dots"
                          aria-label="Banner 切换"
                        >
                          <For each={banners()}>
                            {(_, index) => (
                              <button
                                type="button"
                                classList={{
                                  "hyp-mhy-banner-dot": true,
                                  active: bannerIndex() === index(),
                                }}
                                aria-label={`第 ${index() + 1} 张 Banner`}
                                aria-pressed={bannerIndex() === index()}
                                onClick={() => setBannerIndex(index())}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>

                <Show
                  when={
                    !hasTools() &&
                    (recentPosts().length > 0 || contentPending())
                  }
                >
                  <AnnouncementPosts />
                </Show>
              </section>
            </Show>
            <Show when={hasTools()}>
              <button
                type="button"
                class="hyp-mhy-news"
                aria-haspopup="dialog"
                disabled={props.communityTools?.some(tool => tool.disabled)}
                onClick={() => setAnnouncementsOpen(true)}
              >
                <strong class="hyp-mhy-news-title">
                  {announcementTitle()}
                </strong>
                <span class="hyp-mhy-news-arrow" aria-hidden="true">
                  →
                </span>
                <Show when={featuredAnnouncement()}>
                  {post => (
                    <span class="hyp-mhy-news-preview">
                      <span class="hyp-mhy-news-headline">{post().title}</span>
                      <Show when={post().date}>
                        <time>{post().date}</time>
                      </Show>
                    </span>
                  )}
                </Show>
                <span class="hyp-mhy-news-status">{announcementStatus()}</span>
              </button>
            </Show>
            <Show when={hasTools()}>
              <div class="hyp-mhy-tools">
                <Index each={props.communityTools}>
                  {tool => (
                    <button
                      type="button"
                      class="hyp-mhy-tool"
                      aria-haspopup="dialog"
                      disabled={tool().disabled}
                      onClick={() => tool().open()}
                    >
                      <span class="hyp-mhy-tool-icon" aria-hidden="true">
                        <svg
                          width="19"
                          height="19"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <Switch>
                            <Match when={tool().kind === "pulls"}>
                              <path d="M4 4v16h16M8 16v-3m5 3V9m5 7V6" />
                            </Match>
                            <Match when={tool().kind === "check-in"}>
                              <rect x="4" y="5" width="16" height="16" rx="2" />
                              <path d="M8 3v4m8-4v4M4 10h16m-11 5 2 2 4-4" />
                            </Match>
                          </Switch>
                        </svg>
                      </span>
                      <span class="hyp-mhy-tool-copy">
                        <strong>{tool().title}</strong>
                        <span class="hyp-mhy-tool-description">
                          {tool().status}
                        </span>
                      </span>
                      <span class="hyp-mhy-tool-arrow" aria-hidden="true">
                        →
                      </span>
                    </button>
                  )}
                </Index>
              </div>
            </Show>
          </div>
        </div>
        <Show when={hasTools()}>
          <AppModal
            opened={announcementsOpen()}
            onClose={() => setAnnouncementsOpen(false)}
            title={announcementTitle()}
            contentClass="hyp-mhy-announcements-modal"
            maxWidth={520}
          >
            <Show
              when={showLauncherContent()}
              fallback={<p>{announcementEmpty()}</p>}
            >
              <AnnouncementPosts />
            </Show>
          </AppModal>
        </Show>
      </div>
    </Show>
  );
}
