import { Button, HStack, Tab, TabList, TabPanel, Tabs } from "@hope-ui/solid";
import {
  createMemo,
  createSignal,
  onMount,
  Show,
  type JSXElement,
} from "solid-js";
import MIT_LICENSE_URL from "../assets/licenses/mit-license.md?url";
import COPYRIGHT_NOTICE_URL from "../assets/licenses/copyright-notice.md?url";
import { Locale } from "../locale";
import { open } from "../platform/neutralino";

const GITHUB_LICENSE_URL =
  "https://github.com/MXJinjing/yet-another-anime-game-launcher/blob/main/LICENSE";

type MarkdownBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ordered-list"; items: string[] };

function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length === 0) return;

    if (currentLines.length === 1 && /^#{1,6}\s+/.test(currentLines[0])) {
      blocks.push({
        type: "heading",
        text: currentLines[0].replace(/^#{1,6}\s+/, ""),
      });
    } else if (currentLines.every(line => /^\d+\.\s+/.test(line))) {
      blocks.push({
        type: "ordered-list",
        items: currentLines.map(line => line.replace(/^\d+\.\s+/, "")),
      });
    } else {
      blocks.push({ type: "paragraph", lines: [...currentLines] });
    }

    currentLines = [];
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      flush();
    } else {
      currentLines.push(line.trim());
    }
  }
  flush();

  return blocks;
}

function renderInlineMarkdown(text: string) {
  return text.split(/(`[^`]+`)/g).map(part => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function renderMarkdownBlock(block: MarkdownBlock): JSXElement {
  switch (block.type) {
    case "heading":
      return (
        <h1 class="license-markdown-heading">
          {renderInlineMarkdown(block.text)}
        </h1>
      );
    case "ordered-list":
      return (
        <ol class="license-markdown-list">
          {block.items.map(item => (
            <li>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      );
    case "paragraph":
      return (
        <p class="license-markdown-paragraph">
          {renderInlineMarkdown(block.lines.join(" "))}
        </p>
      );
  }
}

function MarkdownLicense(props: { content: string; failed: boolean }) {
  const blocks = createMemo(() => parseMarkdown(props.content));

  return (
    <div class="license-document">
      <Show
        when={props.content}
        fallback={
          <p class="license-markdown-status">
            {props.failed ? "Unable to load license." : "Loading license..."}
          </p>
        }
      >
        {blocks().map(renderMarkdownBlock)}
      </Show>
    </div>
  );
}

const LICENSE_URLS = [MIT_LICENSE_URL, COPYRIGHT_NOTICE_URL];

export function LicenseModal(props: { locale: Locale }) {
  const [selectedLicense, setSelectedLicense] = createSignal(0);
  const [licenseContents, setLicenseContents] = createSignal<string[]>([]);
  const [loadError, setLoadError] = createSignal(false);

  onMount(() => {
    void Promise.all(
      LICENSE_URLS.map(async url => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load license: ${response.status}`);
        }
        return response.text();
      })
    )
      .then(setLicenseContents)
      .catch(() => setLoadError(true));
  });

  return (
    <Tabs
      class="license-tabs"
      h="100%"
      display="flex"
      flexDirection="column"
      variant="pills"
      index={selectedLicense()}
      onChange={setSelectedLicense}
    >
      <HStack class="license-tabs-header" mb={"$4"}>
        <TabList>
          <Tab>MIT License</Tab>
          <Tab>Copyright Notice</Tab>
        </TabList>
        <Button
          class="license-tabs-online"
          variant="ghost"
          size="sm"
          onClick={() => void open(GITHUB_LICENSE_URL)}
        >
          {props.locale.get("LICENSE_VIEW_ONLINE")}
        </Button>
      </HStack>
      <TabPanel px={0} pt={0} pb={0} overflowY="auto">
        <MarkdownLicense
          content={licenseContents()[0] ?? ""}
          failed={loadError()}
        />
      </TabPanel>
      <TabPanel px={0} pt={0} pb={0} overflowY="auto">
        <MarkdownLicense
          content={licenseContents()[1] ?? ""}
          failed={loadError()}
        />
      </TabPanel>
    </Tabs>
  );
}
