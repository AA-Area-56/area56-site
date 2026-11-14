#!/usr/bin/env node
// Converts a WordPress export (Tools → Export → All content) into an archive
// folder of Markdown, and downloads the site's uploaded files.
//
//   npm run migrate                        # newest *.WordPress.*.xml in this folder
//   npm run migrate -- path/to/export.xml
//   npm run migrate -- --no-media          # Markdown only, skip downloads
//
// Output (nothing already in src/ is overwritten):
//   migration/posts/YYYY-MM-DD-slug.md
//   migration/pages/slug.md
//   migration/events/YYYY-MM-DD-slug.md    (calendar plugin; see the note below)
//   src/uploads/wp/<year>/<month>/<file>   (downloaded media)
//   migration/report.json                  (counts, failures, items to review)
//
// Only published, non-password-protected content is written. The export file
// also holds drafts, private posts, and author emails, so keep it out of Git.
//
// Review migration/ by hand and move what's worth keeping into the right
// collection (announcements, delegates-corner, documents, pages).
//
// Event dates live in the calendar plugin's own tables, not in the export, so
// event files carry only the date they were posted.

import fs from "node:fs/promises";
import path from "node:path";
import TurndownService from "turndown";
import { XMLParser } from "fast-xml-parser";

const OUT = "migration";
const UPLOADS = "src/uploads/wp";
const args = process.argv.slice(2);
const SKIP_MEDIA = args.includes("--no-media");

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
turndown.remove(["script", "style", "form", "noscript"]);
turndown.keep(["table"]); // Markdown tables can't hold merged cells; keep the HTML.

async function findExport() {
  const given = args.find((a) => !a.startsWith("--"));
  if (given) return given;
  const names = (await fs.readdir(".")).filter((f) => /\.WordPress\..*\.xml$/.test(f));
  if (!names.length) throw new Error("No export found. Pass the path to the WordPress XML file.");
  const stats = await Promise.all(names.map(async (f) => [f, (await fs.stat(f)).mtimeMs]));
  return stats.sort((a, b) => b[1] - a[1])[0][0];
}

async function readItems(file) {
  // WordPress can export control characters that aren't legal in XML.
  const xml = (await fs.readFile(file, "utf8")).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
    isArray: (name) => ["item", "wp:postmeta", "category"].includes(name),
  });
  const { channel } = parser.parse(xml).rss;
  return { base: String(channel["wp:base_site_url"]).replace(/\/$/, ""), items: channel.item };
}

const text = (v) => String(v ?? "");

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n))
   .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
   .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
   .replace(/&amp;/g, "&");

const yamlString = (s) => JSON.stringify(decode(s).trim());

// The export holds content before WordPress adds paragraph tags, so posts from
// the classic editor separate paragraphs with blank lines only.
const BLOCK_START = /^<\/?(p|div|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|figure|figcaption|hr|form|iframe|object|embed|video|section|article|address|center)\b/i;

function addParagraphs(html) {
  return html
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (BLOCK_START.test(chunk) ? chunk : `<p>${chunk.replace(/\n/g, "<br>\n")}</p>`))
    .join("\n\n");
}

function replaceShortcodes(html) {
  const note = (what) => `<p><strong>Migration note: ${what} was here on the old site.</strong></p>`;
  return html
    .replace(/\[\/?caption\b[^\]]*\]/g, "")
    .replace(/\[contact-form-7\b[^\]]*\]/g, note("a contact form"))
    .replace(/\[ai1ec\b[^\]]*\]/g, note("a calendar"));
}

// The converter silently drops embeds, so turn each into a link, unless the
// page already links to the same file (WordPress file blocks do).
function keepEmbeds(html) {
  const link = (_, url) =>
    html.includes(`href="${url}"`) ? "" : `<p><a href="${url}">Embedded content: ${url}</a></p>`;
  return html
    .replace(/<iframe\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi, link)
    .replace(/<object\b[^>]*?\bdata=["']([^"']+)["'][^>]*>[\s\S]*?<\/object>/gi, link)
    .replace(/<embed\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, link)
    .replace(/<video\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi, link)
    .replace(/<video\b[^>]*>\s*<source\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi, link);
}

// What the converter can't fully carry over, so a person should compare it.
function reviewFlags(html) {
  const checks = {
    table: /<table\b/i,
    form: /<form\b|\[contact-form-7\b/i,
    embed: /<(iframe|object|embed|video)\b/i,
    calendar: /\[ai1ec\b/i,
    "template syntax": /\{\{|\{%/,
  };
  const flags = Object.keys(checks).filter((k) => checks[k].test(html));
  if (!html.trim()) flags.push("empty");
  return flags;
}

async function main() {
  const file = await findExport();
  const { base, items } = await readItems(file);
  console.log(`Reading ${file} (${items.length} items from ${base}) …`);

  const host = base.replace(/^https?:\/\/(www\.)?/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uploadRe = new RegExp(
    `(?:https?://(?:www\\.)?${host})?/wp-content/uploads/([^"'\\s?#<>\\\\]+)`, "g"
  );
  const wanted = new Set();
  const rewriteUploads = (s) =>
    s.replace(uploadRe, (_, rel) => {
      wanted.add(rel);
      return `/uploads/wp/${rel}`;
    });

  const type = (i) => text(i["wp:post_type"]);
  const status = (i) => text(i["wp:status"]);
  const attachments = items.filter((i) => type(i) === "attachment");
  const attachmentUrl = new Map(attachments.map((a) => [text(a["wp:post_id"]), text(a["wp:attachment_url"])]));
  const isPublic = (i) => status(i) === "publish" && !text(i["wp:post_password"]);

  const report = {
    source: base,
    export: path.basename(file),
    migrated: { posts: 0, pages: 0, events: 0 },
    skipped: {},
    media_referenced: 0,
    media_downloaded: 0,
    media_already_present: 0,
    failures: [],
    media_from_unpublished_items: [],
    needs_review: [],
  };

  const writers = {
    post: (i) => [
      "posts",
      `${text(i["wp:post_date"]).slice(0, 10)}-${text(i["wp:post_name"]) || text(i["wp:post_id"])}.md`,
    ],
    page: (i) => ["pages", `${text(i["wp:post_name"]) || text(i["wp:post_id"])}.md`],
    ai1ec_event: (i) => [
      "events",
      `${text(i["wp:post_date"]).slice(0, 10)}-${text(i["wp:post_name"]) || text(i["wp:post_id"])}.md`,
    ],
  };
  const counters = { post: "posts", page: "pages", ai1ec_event: "events" };

  for (const item of items) {
    const t = type(item);
    if (t === "attachment") continue;
    if (!writers[t] || !isPublic(item)) {
      const key = `${t} / ${status(item)}`;
      report.skipped[key] = (report.skipped[key] || 0) + 1;
      continue;
    }

    const raw = text(item["content:encoded"]);
    const meta = item["wp:postmeta"] || [];
    const thumbId = text(meta.find((m) => text(m["wp:meta_key"]) === "_thumbnail_id")?.["wp:meta_value"]);
    const categories = (item.category || [])
      .filter((c) => c["@_domain"] === "category")
      .map((c) => decode(text(c["#text"])));
    const featured = attachmentUrl.get(thumbId);
    const dateKey = t === "ai1ec_event" ? "posted" : "date";

    const front = {
      title: yamlString(text(item.title)),
      [dateKey]: t === "page" ? undefined : text(item["wp:post_date"]).slice(0, 10),
      wp_category: categories.length ? JSON.stringify(categories.join(", ")) : undefined,
      image: featured ? rewriteUploads(featured) : undefined,
      wp_last_modified: t === "page" ? text(item["wp:post_modified"]).slice(0, 10) : undefined,
      wp_id: text(item["wp:post_id"]),
    };
    const fm = Object.entries(front)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prepared = raw.includes("<!-- wp:") ? raw : addParagraphs(raw);
    const html = rewriteUploads(keepEmbeds(replaceShortcodes(prepared)));
    const [dir, filename] = writers[t](item);
    await fs.mkdir(path.join(OUT, dir), { recursive: true });
    await fs.writeFile(path.join(OUT, dir, filename), `---\n${fm}\n---\n\n${turndown.turndown(html)}\n`);
    report.migrated[counters[t]]++;

    const flags = reviewFlags(raw);
    if (flags.length) {
      report.needs_review.push({ file: path.join(OUT, dir, filename), title: decode(text(item.title)), contains: flags });
    }
  }

  // Also grab media that nothing links to (PDFs often aren't), and list files
  // attached to drafts or private posts so a person can decide about them.
  const byId = new Map(items.map((i) => [text(i["wp:post_id"]), i]));
  for (const a of attachments) {
    const local = rewriteUploads(text(a["wp:attachment_url"]));
    const parent = byId.get(text(a["wp:post_parent"]));
    if (parent && !isPublic(parent)) report.media_from_unpublished_items.push(local);
  }
  report.media_referenced = wanted.size;

  if (!SKIP_MEDIA) {
    const list = [...wanted];
    console.log(`Downloading ${list.length} files …`);
    for (const rel of list) {
      try {
        if (rel.split("/").includes("..")) throw new Error("unsafe path");
        const dest = path.join(UPLOADS, rel);
        const exists = await fs.access(dest).then(() => true, () => false);
        if (exists) {
          report.media_already_present++;
          continue;
        }
        const res = await fetch(`${base}/wp-content/uploads/${rel}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
        report.media_downloaded++;
      } catch (e) {
        report.failures.push({ file: rel, error: e.message });
      }
    }
  }

  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  const { needs_review, media_from_unpublished_items, failures, ...summary } = report;
  console.log({
    ...summary,
    failures: failures.length,
    media_from_unpublished_items: media_from_unpublished_items.length,
    needs_review: needs_review.length,
  });
  console.log(`Details: ${path.join(OUT, "report.json")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
