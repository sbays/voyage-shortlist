import { createElement, type HTMLAttributes } from "react";

// A heading whose level is chosen by the caller, so the shortlist fits under
// an h1 on the home page and under an h2 on a saved brief's page.

export type HeadingTag = "h2" | "h3" | "h4" | "h5";

const TAGS: HeadingTag[] = ["h2", "h3", "h4", "h5"];

/** The tag `depth` levels below a title at `level` (2 or 3). */
export function headingTag(level: 2 | 3, depth: number): HeadingTag {
  return TAGS[Math.min(level - 2 + depth, TAGS.length - 1)];
}

export function Heading({ tag, ...props }: { tag: HeadingTag } & HTMLAttributes<HTMLHeadingElement>) {
  return createElement(tag, props);
}
