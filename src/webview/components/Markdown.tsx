import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { escapeRegExp } from "@/lib/search";

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

export const Markdown = memo(function Markdown({ text, query, current = -1 }: Props) {
  const plugins = useMemo(() => [[rehypeMark, { query, current }] as const], [query, current]);
  return (
    <div className="md">
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
