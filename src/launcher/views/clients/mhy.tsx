import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
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

export function MhyClientView(props: {
  client: ChannelClient;
  channelName?: string;
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
  const hasContent = createMemo(
    () =>
      launcherIconButtons().length > 0 ||
      banners().length > 0 ||
      recentPosts().length > 0 ||
      socialMedia().length > 0
  );

  function moveBanner(offset: number) {
    const count = banners().length;
    if (count < 2) return;
    setBannerIndex(index => (index + offset + count) % count);
  }

  return (
    <Show when={hasContent() && !props.client.uiContent.channelName}>
      <div class="hyp-mhy-content" aria-label="公告和社交媒体">
        <Show when={socialMedia().length > 0}>
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
                      <img src={social.icon.url} alt="" />
                      <Show when={social.enable_red_dot}>
                        <span
                          class="hyp-mhy-social-dot"
                          aria-hidden="true"
                        />
                      </Show>
                    </button>
                  </div>
                );
              }}
            </For>
          </aside>
        </Show>

        <div class="hyp-mhy-board-stack">
          <Show when={launcherIconButton()}>
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

          <section class="hyp-mhy-board" aria-label="公告板">
            <Show when={currentBanner()}>
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

            <Show when={recentPosts().length > 0}>
              <div class="hyp-mhy-posts">
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
              </div>
            </Show>
          </section>
        </div>
      </div>
    </Show>
  );
}
