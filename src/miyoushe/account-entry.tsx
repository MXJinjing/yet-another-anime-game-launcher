import {
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from "@hope-ui/solid";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { AppModal, AppModalButton } from "@src/components/app-modal";
import userIcon from "@src/assets/icons/user.svg";
import trashIcon from "@src/assets/icons/trash.svg";
import type { Reply } from "./account";
import type { MiyousheGame } from "./games";
import { roleKey, type MiyousheSession } from "./session";
import { notifyMiyoushe } from "./notifications";
import "./account.css";

type Translate = (zh: string, en: string) => string;

function Avatar(props: { url?: string }) {
  const [failed, setFailed] = createSignal<string>();
  const photo = () =>
    props.url && failed() !== props.url ? props.url : undefined;
  return (
    <img
      class="miyoushe-avatar"
      data-photo={Boolean(photo())}
      src={photo() ?? userIcon}
      referrerpolicy="no-referrer"
      alt=""
      onError={() => setFailed(props.url)}
    />
  );
}

export function MiyousheRolePicker(props: {
  t: Translate;
  game: MiyousheGame;
  session: MiyousheSession;
  disabled?: boolean;
  onChange?: () => void;
}) {
  const t = props.t;
  const session = props.session;
  const fallback = () =>
    session.rolesLoading()
      ? t("正在读取角色…", "Loading characters…")
      : session.roleError()
      ? t("暂时无法读取官服角色。", "Could not load official CN characters.")
      : t(
          "当前账号没有可用的官服角色。",
          "This account has no eligible official CN characters."
        );

  return (
    <Show
      when={session.roles().length}
      fallback={
        <p class="miyoushe-muted" role="status">
          {fallback()}
        </p>
      }
    >
      <label class="miyoushe-field">
        {t("当前角色", "Current character")}
        <select
          value={session.selectedRole() ? roleKey(session.selectedRole()!) : ""}
          disabled={props.disabled || session.busy()}
          onChange={event => {
            const account = session.active();
            if (!account) return;
            session.setPreference(account.id, props.game, {
              role: event.currentTarget.value,
            });
            props.onChange?.();
          }}
        >
          <Show when={!session.selectedRole()}>
            <option value="" disabled>
              {t("请选择角色", "Select a character")}
            </option>
          </Show>
          <For each={session.roles()}>
            {role => (
              <option value={roleKey(role)}>
                {role.nickname || role.region} · ••••{role.uid.slice(-4)}
              </option>
            )}
          </For>
        </select>
      </label>
    </Show>
  );
}

export function MiyousheAccountEntry(props: {
  t: Translate;
  game?: MiyousheGame;
  session: MiyousheSession;
  disabled: boolean;
  accent: string;
  accentText: string;
  onLogin: () => void;
}) {
  const t = props.t;
  const session = props.session;
  const [removing, setRemoving] = createSignal<string>();
  const style = () => ({
    "--miyo-accent": props.accent,
    "--miyo-accent-text": props.accentText,
  });
  const activeId = () => session.active()?.id;
  const title = () => t("米游社账号", "Miyoushe accounts");

  return (
    <>
      <Show
        when={props.game}
        fallback={
          <button
            type="button"
            class="hyp-orbit-button"
            aria-label="Yaaglm"
            disabled
          >
            <Avatar />
          </button>
        }
      >
        <Popover
          placement="right-start"
          offset={12}
          onClose={() => setRemoving(undefined)}
        >
          {({ onClose }) => (
            <>
              <PopoverTrigger
                class="hyp-orbit-button miyoushe-account-trigger"
                aria-label={title()}
                disabled={props.disabled}
              >
                <Avatar url={session.active()?.profile.avatar} />
              </PopoverTrigger>
              <PopoverContent class="hyp-menu-popover-content">
                <PopoverBody class="hyp-menu-popover-body">
                  <section
                    class="miyoushe-account-menu"
                    style={style()}
                    aria-label={title()}
                  >
                    <div class="miyoushe-account-menu-heading">
                      <h2>{title()}</h2>
                      <Show when={session.status() !== "official"}>
                        <AppModalButton
                          variant="primary"
                          disabled={
                            session.busy() || session.status() === "loading"
                          }
                          onClick={() => {
                            onClose();
                            props.onLogin();
                          }}
                        >
                          {activeId() && session.status() !== "expired"
                            ? t("登录其他账号", "Sign in another account")
                            : t("仅本次登录", "Sign in for this session")}
                        </AppModalButton>
                      </Show>
                    </div>
                    <Show
                      when={session.accounts().length}
                      fallback={
                        <p class="miyoushe-muted" role="status">
                          {session.status() === "official"
                            ? t(
                                "启动器内登录仅在开发版提供。",
                                "In-launcher sign-in is available in development builds."
                              )
                            : session.status() === "loading"
                            ? t("正在读取账号…", "Loading accounts…")
                            : t(
                                "扫码登录在本次启动期间有效。",
                                "Sign-in lasts for this launcher session."
                              )}
                        </p>
                      }
                    >
                      <div class="miyoushe-account-list">
                        <For each={session.accounts()}>
                          {account => {
                            const selected = () => activeId() === account.id;
                            const confirming = () => removing() === account.id;
                            const name = () =>
                              account.profile.nickname ||
                              t("米游社用户", "Miyoushe user");
                            return (
                              <div
                                class="miyoushe-account-card"
                                data-active={selected()}
                              >
                                <button
                                  class="miyoushe-account-list-item"
                                  type="button"
                                  aria-pressed={selected()}
                                  disabled={session.busy()}
                                  onClick={() => {
                                    if (selected()) return;
                                    setRemoving(undefined);
                                    void session.select(account.id);
                                  }}
                                >
                                  <Avatar url={account.profile.avatar} />
                                  <span class="miyoushe-account-identity">
                                    <strong>{name()}</strong>
                                    <small>{account.profile.maskedId}</small>
                                  </span>
                                  <Show when={selected()}>
                                    <span class="miyoushe-account-current">
                                      {session.status() === "expired"
                                        ? t("已过期", "Expired")
                                        : t("当前账号", "Active")}
                                    </span>
                                  </Show>
                                </button>
                                <button
                                  class="miyoushe-account-remove"
                                  type="button"
                                  title={t("移除账号", "Remove account")}
                                  aria-label={
                                    t("移除账号 ", "Remove account ") + name()
                                  }
                                  aria-expanded={confirming()}
                                  disabled={session.busy()}
                                  onClick={() =>
                                    setRemoving(
                                      confirming() ? undefined : account.id
                                    )
                                  }
                                >
                                  <img src={trashIcon} alt="" />
                                </button>
                                <Show when={confirming()}>
                                  <div class="miyoushe-account-removal">
                                    <span>
                                      {t(
                                        "从此启动器移除账号？",
                                        "Remove this account from this launcher?"
                                      )}
                                    </span>
                                    <button
                                      type="button"
                                      class="miyoushe-menu-link"
                                      disabled={session.busy()}
                                      onClick={async () => {
                                        await session.remove(account.id);
                                        setRemoving(value =>
                                          value === account.id
                                            ? undefined
                                            : value
                                        );
                                      }}
                                    >
                                      {t("移除", "Remove")}
                                    </button>
                                    <button
                                      type="button"
                                      class="miyoushe-menu-link"
                                      onClick={() => setRemoving(undefined)}
                                    >
                                      {t("取消", "Cancel")}
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </section>
                </PopoverBody>
              </PopoverContent>
            </>
          )}
        </Popover>
      </Show>
    </>
  );
}

export function MiyousheLoginDialog(props: {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
  game?: MiyousheGame;
  t: Translate;
  session: MiyousheSession;
  theme: Record<string, string>;
}) {
  const t = props.t;
  const [qr, setQr] = createSignal<{ image: string; scanned: boolean }>();
  const [loading, setLoading] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [failure, setFailure] = createSignal<Reply["state"] | "cancelled">();
  let request: AbortController | undefined;
  let queued = false;

  async function start() {
    const game = props.game;
    if (!game) return;
    if (request) {
      queued = true;
      request.abort();
      return;
    }
    const controller = new AbortController();
    request = controller;
    setQr(undefined);
    setFailure(undefined);
    setLoading(true);
    try {
      const result = await props.session.login(
        game,
        (image, scanned) => {
          setQr({ image, scanned });
          setLoading(false);
        },
        controller.signal,
        () => setConfirming(true)
      );
      if (!controller.signal.aborted) {
        if (result === "ok") props.onSuccess();
        else {
          setFailure(result);
          notifyMiyoushe(
            "warning",
            t("米游社登录未完成", "Miyoushe sign-in did not complete"),
            failureText(result)
          );
        }
      }
    } finally {
      request = undefined;
      setLoading(false);
      setConfirming(false);
      const next = queued;
      queued = false;
      if (next && props.opened) void start();
    }
  }

  createEffect(
    on(
      () => props.opened,
      opened => {
        if (opened) void start();
        else {
          queued = false;
          request?.abort();
        }
      }
    )
  );
  onCleanup(() => request?.abort());

  const failureText = (state: string) =>
    ({
      expired: t(
        "二维码已过期，请刷新后重试。",
        "This code expired. Refresh it to try again."
      ),
      network: t("暂时无法连接米游社。", "Could not reach Miyoushe."),
      limited: t(
        "请求过于频繁，请稍后重试。",
        "Too many requests. Try again later."
      ),
      manual: t(
        "请在手机端完成验证后重试。",
        "Complete verification on your phone and try again."
      ),
    }[state as "expired" | "network" | "limited" | "manual"] ??
    t("请重试。", "Try again."));

  return (
    <AppModal
      opened={props.opened}
      onClose={() => {
        if (!confirming()) props.onClose();
      }}
      overlayClass="app-modal-overlay--nested"
      contentClass="miyoushe-modal miyoushe-login-modal app-modal-content--nested window-no-drag"
      bodyClass="miyoushe-modal-body"
      title={<strong>{t("登录米游社", "Sign in to Miyoushe")}</strong>}
      maxWidth={590}
    >
      <div class="miyoushe-login-layout" style={props.theme}>
        <div class="miyoushe-login-copy">
          <h2>{t("用米游社 App 扫码", "Scan with the Miyoushe app")}</h2>
          <p>
            {t(
              "扫码并在手机上确认。关闭启动器后，下次需重新扫码。",
              "Scan and confirm on your phone. Sign in again after quitting the launcher."
            )}
          </p>
          <div class="miyoushe-login-state" role="status">
            {failure()
              ? t("等待重试", "Waiting to retry")
              : confirming()
              ? t("正在验证账号…", "Verifying your account…")
              : qr()?.scanned
              ? t("已扫码，请在手机上确认。", "Scanned. Confirm on your phone.")
              : loading()
              ? t("正在获取二维码…", "Preparing your QR code…")
              : t("等待扫码", "Waiting for scan")}
          </div>
          <div class="miyoushe-actions">
            <Show when={failure()}>
              <AppModalButton
                variant="primary"
                disabled={props.session.busy()}
                onClick={() => void start()}
              >
                {t("刷新二维码", "Refresh code")}
              </AppModalButton>
            </Show>
            <AppModalButton disabled={confirming()} onClick={props.onClose}>
              {t("取消", "Cancel")}
            </AppModalButton>
          </div>
        </div>
        <div
          class="miyoushe-login-code"
          classList={{ "miyoushe-login-code--scanned": !!qr()?.scanned }}
        >
          <Show
            when={qr() && !failure() ? qr() : undefined}
            fallback={<Avatar />}
          >
            {code => (
              <img
                class="miyoushe-qr"
                src={"data:image/png;base64," + code().image}
                alt={t("米游社登录二维码", "Miyoushe sign-in QR code")}
              />
            )}
          </Show>
        </div>
      </div>
    </AppModal>
  );
}
