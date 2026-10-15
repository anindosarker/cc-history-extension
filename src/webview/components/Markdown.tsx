import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseFileRef } from "@shared/fileRef";
import { useAgents } from "@/lib/agents";
import { escapeRegExp } from "@/lib/search";
import { post } from "@/lib/vscode";

interface Props {
  text: string;
  query: string;
  current?: number;
}

interface HastText {
  type: "text";
  value: string;
}
interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}
interface HastOther {
  type: string;
  children?: HastNode[];
}
type HastNode = HastText | HastElement | HastOther;

/** Rehype plugin that wraps query hits in mark elements, numbering them in document order. */
function rehypeMark(options: { query: string; current: number }) {
  const { query, current } = options;
  return (tree: HastNode) => {
    if (!query) return;
    const re = new RegExp(escapeRegExp(query), "gi");
    let occ = 0;
    const visit = (node: HastNode) => {
      if (!("children" in node) || !node.children) return;
      if (node.type === "element" && (node as HastElement).tagName === "mark") return;
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text") {
          visit(child);
          next.push(child);
          continue;
        }
        const value = (child as HastText).value;
        let last = 0;
        for (const m of value.matchAll(re)) {
          const i = m.index ?? 0;
          if (i > last) next.push({ type: "text", value: value.slice(last, i) });
          const props: Record<string, unknown> = {};
          if (occ === current) props.dataCurrent = "true";
          next.push({
            type: "element",
            tagName: "mark",
            properties: props,
            children: [{ type: "text", value: m[0] }],
          });
          occ++;
          last = i + m[0].length;
        }
        if (last === 0) next.push(child);
        else if (last < value.length) next.push({ type: "text", value: value.slice(last) });
      }
      node.children = next;
    };
    visit(tree);
  };
}

/** Rehype plugin that tags inline code spans holding a file path so they can be opened on click. */
function rehypeFileLinks() {
  return (tree: HastNode) => {
    const visit = (node: HastNode, inPre: boolean) => {
      if (!("children" in node) || !node.children) return;
      for (const child of node.children) {
        if (child.type !== "element") continue;
        const el = child as HastElement;
        if (el.tagName === "pre") {
          visit(el, true);
          continue;
        }
        if (el.tagName === "code" && !inPre && el.children.length === 1 && el.children[0].type === "text") {
          const ref = parseFileRef((el.children[0] as HastText).value);
          if (ref) {
            const props = (el.properties ??= {});
            props.dataFilePath = ref.path;
            if (ref.line !== undefined) props.dataLine = String(ref.line);
            if (ref.column !== undefined) props.dataColumn = String(ref.column);
            props.className = ["file-link"];
            props.role = "link";
            props.tabIndex = 0;
            props.title = `Open ${ref.path}${ref.line !== undefined ? `:${ref.line}` : ""}`;
          }
        }
        visit(el, inPre);
      }
    };
    visit(tree, false);
  };
}

/** Rehype plugin that wraps "@name" tokens naming a known agent in a span, outside code. */
export function rehypeMentions(options: { names: string[] }) {
  const names = options.names;
  return (tree: HastNode) => {
    if (names.length === 0) return;
    const set = new Set(names);
    const re = /(^|[^\w@])@([\w-]+)/g;
    const visit = (node: HastNode) => {
      if (!("children" in node) || !node.children) return;
      if (node.type === "element") {
        const tag = (node as HastElement).tagName;
        if (tag === "code" || tag === "pre" || tag === "a" || tag === "mark") return;
      }
      const next: HastNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text") {
          visit(child);
          next.push(child);
          continue;
        }
        const value = (child as HastText).value;
        let last = 0;
        let hit = false;
        for (const m of value.matchAll(re)) {
          if (!set.has(m[2])) continue;
          const start = (m.index ?? 0) + m[1].length;
          hit = true;
          if (start > last) next.push({ type: "text", value: value.slice(last, start) });
          next.push({
            type: "element",
            tagName: "span",
            properties: { className: ["agent-mention"] },
            children: [{ type: "text", value: `@${m[2]}` }],
          });
          last = start + 1 + m[2].length;
        }
        if (!hit) next.push(child);
        else if (last < value.length) next.push({ type: "text", value: value.slice(last) });
      }
      node.children = next;
    };
    visit(tree);
  };
}

/** The file reference carried by a clicked or activated element, when it is a file link. */
export function fileRefOf(target: EventTarget | null): { path: string; line?: number; column?: number } | undefined {
  const el = (target as HTMLElement | null)?.closest?.("[data-file-path]") as HTMLElement | null;
  const path = el?.dataset.filePath;
  if (!path) return undefined;
  const line = el?.dataset.line ? Number(el.dataset.line) : undefined;
  const column = el?.dataset.column ? Number(el.dataset.column) : undefined;
  return { path, ...(line ? { line } : {}), ...(column ? { column } : {}) };
}

export function openFileRef(ref: { path: string; line?: number; column?: number }): void {
  post({ type: "revealFile", ...ref });
}

export const Markdown = memo(function Markdown({ text, query, current = -1 }: Props) {
  const { agents } = useAgents();
  const names = useMemo(() => agents.map((a) => a.name), [agents]);
  const plugins = useMemo(
    () => [rehypeFileLinks, [rehypeMentions, { names }] as const, [rehypeMark, { query, current }] as const],
    [names, query, current],
  );
  return (
    <div
      className="md"
      onClick={(e) => {
        const ref = fileRefOf(e.target);
        if (!ref) return;
        e.preventDefault();
        openFileRef(ref);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const ref = fileRefOf(e.target);
        if (!ref) return;
        e.preventDefault();
        openFileRef(ref);
      }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // The cast keeps react-markdown's plugin tuple typing happy with our local plugin.
        rehypePlugins={plugins as unknown as never}
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
