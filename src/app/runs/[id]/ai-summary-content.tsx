"use client";

/**
 * Renders AI summary text with rich formatting:
 * - Sections: **Heading** blocks rendered as distinct visual sections
 * - Key Risks: numbered items rendered as structured risk cards
 * - Verdict: rendered as a callout box
 * - Inline: **bold**, highlighted numbers, percentages, temperatures, dollar amounts
 * - Bullet lists (- item) and numbered lists (1. item)
 */
export function AiSummaryContent({ text }: { text: string }) {
  const sections = parseSections(text);

  return (
    <div className="space-y-5">
      {sections.map((section, si) => (
        <SectionRenderer key={si} section={section} />
      ))}
    </div>
  );
}

// ═══ Section parsing ═══

interface Section {
  type: "paragraph" | "heading-list" | "verdict" | "bullet-list";
  heading?: string;
  content?: string;
  items?: ListItem[];
}

interface ListItem {
  number?: string;
  label?: string; // bold label before colon (e.g. "Risk Name")
  text: string;
}

function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  // Split into blocks by double newline
  const blocks = text.split(/\n\n+/).filter((b) => b.trim());

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i].trim();

    // Check for heading: **Something** or **Something:**
    const headingOnly = block.match(/^\*\*(.+?)(?::)?\*\*\s*$/);
    if (headingOnly) {
      const heading = headingOnly[1].replace(/:$/, "");
      // Check if next block is a list
      if (i + 1 < blocks.length) {
        const nextBlock = blocks[i + 1].trim();
        const listItems = parseListItems(nextBlock);
        if (listItems.length > 0) {
          // Is this a verdict section?
          const isVerdict = /verdict/i.test(heading);
          if (isVerdict) {
            sections.push({
              type: "verdict",
              heading,
              content: nextBlock,
            });
          } else {
            sections.push({
              type: "heading-list",
              heading,
              items: listItems,
            });
          }
          i += 2;
          continue;
        }
      }
      // Heading with no list after it — just show as heading + nothing
      // Check if it's verdict with inline content
      i++;
      continue;
    }

    // Mixed: heading + list in same block (e.g. "**Key Risks:**\n1. ...")
    const mixedMatch = block.match(/^\*\*(.+?)(?::)?\*\*\n([\s\S]+)/);
    if (mixedMatch) {
      const heading = mixedMatch[1].replace(/:$/, "");
      const rest = mixedMatch[2].trim();
      const isVerdict = /verdict/i.test(heading);

      if (isVerdict) {
        sections.push({
          type: "verdict",
          heading,
          content: rest,
        });
        i++;
        continue;
      }

      const listItems = parseListItems(rest);
      if (listItems.length > 0) {
        sections.push({
          type: "heading-list",
          heading,
          items: listItems,
        });
        i++;
        continue;
      }

      // Heading + paragraph content
      sections.push({
        type: "verdict", // reuse verdict styling for any heading+content
        heading,
        content: rest,
      });
      i++;
      continue;
    }

    // Check for standalone list
    const listItems = parseListItems(block);
    if (listItems.length > 0) {
      sections.push({
        type: "bullet-list",
        items: listItems,
      });
      i++;
      continue;
    }

    // Default: paragraph
    sections.push({
      type: "paragraph",
      content: block,
    });
    i++;
  }

  return sections;
}

function parseListItems(text: string): ListItem[] {
  const lines = text.split("\n").filter((l) => l.trim());
  // Check if all lines are list items (numbered or bullet)
  const isAllList = lines.every(
    (l) => /^\d+[\.\)]\s/.test(l.trim()) || /^[-•*]\s/.test(l.trim())
  );
  if (!isAllList || lines.length === 0) return [];

  return lines.map((line) => {
    const trimmed = line.trim();

    // Numbered: "1. **Label:** text" or "1. text"
    const numMatch = trimmed.match(/^(\d+)[\.\)]\s*(.+)/);
    // Bullet: "- **Label:** text" or "- text"
    const bulletMatch = trimmed.match(/^[-•*]\s+(.+)/);

    const raw = numMatch ? numMatch[2] : bulletMatch ? bulletMatch[1] : trimmed;
    const num = numMatch ? numMatch[1] : undefined;

    // Extract bold label: "**Risk Name:** rest"
    const labelMatch = raw.match(/^\*\*(.+?)\*\*[:\s]*(.+)/);
    if (labelMatch) {
      return {
        number: num,
        label: labelMatch[1],
        text: labelMatch[2].trim(),
      };
    }

    return {
      number: num,
      text: raw,
    };
  });
}

// ═══ Renderers ═══

function SectionRenderer({ section }: { section: Section }) {
  switch (section.type) {
    case "paragraph":
      return (
        <p className="text-sm leading-relaxed text-foreground">
          <RenderInline text={section.content ?? ""} />
        </p>
      );

    case "heading-list":
      return (
        <div className="space-y-2.5">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            {getSectionIcon(section.heading ?? "")}
            {section.heading}
          </h4>
          <div className="space-y-2">
            {section.items?.map((item, i) => (
              <RiskItem key={i} item={item} index={i} sectionHeading={section.heading ?? ""} />
            ))}
          </div>
        </div>
      );

    case "verdict":
      return (
        <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-primary mb-1.5 flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            {section.heading ?? "Verdict"}
          </h4>
          <p className="text-sm font-medium leading-relaxed text-foreground">
            <RenderInline text={section.content ?? ""} />
          </p>
        </div>
      );

    case "bullet-list":
      return (
        <div className="space-y-2">
          {section.items?.map((item, i) => (
            <RiskItem key={i} item={item} index={i} sectionHeading="" />
          ))}
        </div>
      );

    default:
      return null;
  }
}

function getSectionIcon(heading: string): React.ReactNode {
  const lower = heading.toLowerCase();
  if (lower.includes("risk") || lower.includes("warning") || lower.includes("caveat")) {
    return <span className="text-amber-500">⚠</span>;
  }
  if (lower.includes("strength") || lower.includes("advantage") || lower.includes("pro")) {
    return <span className="text-emerald-500">✓</span>;
  }
  return null;
}

function RiskItem({
  item,
  index,
  sectionHeading,
}: {
  item: ListItem;
  index: number;
  sectionHeading: string;
}) {
  const isRisk =
    /risk|warning|caveat|weak/i.test(sectionHeading) ||
    /risk|warning|caveat/i.test(item.label ?? "");

  const bgClass = isRisk
    ? "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40"
    : "bg-muted/40 border-border";

  const numberBgClass = isRisk
    ? "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200"
    : "bg-muted text-muted-foreground";

  return (
    <div className={`flex gap-3 items-start rounded-lg border px-3 py-2.5 ${bgClass}`}>
      <span
        className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 ${numberBgClass}`}
      >
        {item.number ?? index + 1}
      </span>
      <div className="flex-1 min-w-0">
        {item.label ? (
          <>
            <span className="text-sm font-semibold text-foreground">
              {item.label}
            </span>
            <span className="text-sm text-muted-foreground">
              {" — "}
            </span>
            <span className="text-sm leading-relaxed text-foreground">
              <RenderInline text={item.text} />
            </span>
          </>
        ) : (
          <span className="text-sm leading-relaxed text-foreground">
            <RenderInline text={item.text} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Renders inline markdown with highlighted numbers:
 * - **bold** → semibold text
 * - 42.5% → highlighted percentage chip
 * - $12.50 → highlighted dollar chip
 * - -3.2°C or 25°F → highlighted temperature chip
 */
function RenderInline({ text }: { text: string }) {
  // Tokenize: split on bold, percentages, dollar amounts, temperatures
  const tokens = tokenize(text);

  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "bold":
            return (
              <span key={i} className="font-semibold text-foreground">
                {token.value}
              </span>
            );
          case "percentage":
            return (
              <span
                key={i}
                className="font-mono font-semibold bg-primary/10 text-primary px-1 py-0.5 rounded text-xs"
              >
                {token.value}
              </span>
            );
          case "dollar":
            return (
              <span
                key={i}
                className="font-mono font-semibold bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1 py-0.5 rounded text-xs"
              >
                {token.value}
              </span>
            );
          case "temperature":
            return (
              <span
                key={i}
                className="font-mono font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1 py-0.5 rounded text-xs"
              >
                {token.value}
              </span>
            );
          default:
            return <span key={i}>{token.value}</span>;
        }
      })}
    </>
  );
}

interface Token {
  type: "text" | "bold" | "percentage" | "dollar" | "temperature";
  value: string;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Combined regex to match all special patterns
  // Order matters — more specific patterns first
  const pattern =
    /(\*\*[^*]+\*\*)|(\$[\d,]+\.?\d*)|([+-]?\d+\.?\d*\s*(?:°[CF]|degrees?\s*[CF]))|([+-]?\d+\.?\d*%)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Add preceding text
    if (match.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }

    const full = match[0];

    if (match[1]) {
      // Bold: **text**
      tokens.push({ type: "bold", value: full.slice(2, -2) });
    } else if (match[2]) {
      // Dollar: $12.50
      tokens.push({ type: "dollar", value: full });
    } else if (match[3]) {
      // Temperature: -3.2°C, 25°F, 25 degrees C
      tokens.push({ type: "temperature", value: full });
    } else if (match[4]) {
      // Percentage: 42.5%
      tokens.push({ type: "percentage", value: full });
    }

    lastIndex = match.index + full.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  return tokens;
}
