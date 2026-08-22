import { Fragment, type ReactNode } from "react";

/**
 * A deliberately small Markdown subset: headings, lists, bold, italic, inline
 * code. Everything is built from React nodes rather than HTML strings, so model
 * output can never inject markup.
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;

    if (token.startsWith("**")) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    else nodes.push(<em key={key}>{token.slice(1, -1)}</em>);

    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let listItems: string[] = [];
  let listOrdered = false;
  let paragraph: string[] = [];

  const flushList = () => {
    if (!listItems.length) return;
    const items = listItems.map((item, index) => (
      <li key={index}>{inline(item, `li-${blocks.length}-${index}`)}</li>
    ));
    blocks.push(
      listOrdered ? (
        <ol key={`block-${blocks.length}`}>{items}</ol>
      ) : (
        <ul key={`block-${blocks.length}`}>{items}</ul>
      ),
    );
    listItems = [];
  };

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const content = paragraph.join(" ");
    blocks.push(<p key={`block-${blocks.length}`}>{inline(content, `p-${blocks.length}`)}</p>);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const content = inline(heading[2], `h-${blocks.length}`);
      blocks.push(
        level === 1 ? (
          <h1 key={`block-${blocks.length}`}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={`block-${blocks.length}`}>{content}</h2>
        ) : (
          <h3 key={`block-${blocks.length}`}>{content}</h3>
        ),
      );
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || ordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (listItems.length && nextOrdered !== listOrdered) flushList();
      listOrdered = nextOrdered;
      listItems.push((bullet ?? ordered)![1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();

  return <Fragment>{blocks}</Fragment>;
}
