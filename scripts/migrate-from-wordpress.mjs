#!/usr/bin/env node
// Pulls every post and page from the old WordPress site into an archive folder
// as Markdown, and downloads every file they reference from wp-content/uploads.
//
//   node scripts/migrate-from-wordpress.mjs            # from https://aaarea56.org
//   WP_URL=http://localhost:9000 node scripts/...      # from somewhere else
//
// Output (nothing in src/ is overwritten):
//   migration/posts/YYYY-MM-DD-slug.md
//   migration/pages/slug.md
//   src/uploads/wp/<year>/<month>/<file>             (downloaded media)
//   migration/report.json                             (counts, failures)
//
// Review migration/ by hand and move what's worth keeping into the right
// collection (announcements, delegates-corner, documents, pages).

import fs from "node:fs/promises";
import path from "node:path";
import TurndownService from "turndown";

const WP = (process.env.WP_URL || "https://aaarea56.org").replace(/\/$/, "");
const OUT = "migration";
const UPLOADS = "src/uploads/wp";
const SKIP_MEDIA = process.argv.includes("--no-media");

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
turndown.remove(["script", "style", "form", "noscript"]);

async function getAll(type, fields) {
  const items = [];
  for (let page = 1; ; page++) {
    const url = `${WP}/wp-json/wp/v2/${type}?per_page=100&page=${page}&_fields=${fields}`;
    const res = await fetch(url);
    if (res.status === 400) break; // past the last page
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    const batch = await res.json();
    items.push(...batch);
    const totalPages = Number(res.headers.get("x-wp-totalpages") || 1);
    if (page >= totalPages || batch.length === 0) break;
  }
  return items;
}

const decode = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
   .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
   .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

const yamlString = (s) => JSON.stringify(decode(s).trim());

// Cloudflare hides emails in the page; turn them back into mailto links.
function decodeCfEmails(html) {
  const dec = (hex) => {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = "";
    for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    return out;
  };
  return html
    .replace(/<a[^>]*href="\/cdn-cgi\/l\/email-protection#([0-9a-f]+)"[^>]*>.*?<\/a>/gi, (_, h) => `<a href="mailto:${dec(h)}">${dec(h)}</a>`)
    .replace(/<span[^>]*data-cfemail="([0-9a-f]+)"[^>]*>.*?<\/span>/gi, (_, h) => dec(h));
}

const uploadRe = new RegExp(
  `${WP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wp-content/uploads/([^"')\\s?#]+)`, "g"
);
const wanted = new Set();

function rewriteUploads(md) {
  return md.replace(uploadRe, (_, rel) => {
    wanted.add(rel);
    return `/uploads/wp/${rel}`;
  });
}

async function writeEntry(dir, filename, front, html) {
  const md = rewriteUploads(turndown.turndown(decodeCfEmails(html || "")));
  const fm = Object.entries(front)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), `---\n${fm}\n---\n\n${md}\n`);
}

async function download(rel) {
  const dest = path.join(UPLOADS, rel);
  try {
    await fs.access(dest);
    return "exists";
  } catch {}
  const res = await fetch(`${WP}/wp-content/uploads/${rel}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return "downloaded";
}

async function main() {
  console.log(`Reading ${WP} …`);
  const [posts, pages, cats, media] = await Promise.all([
    getAll("posts", "id,date,slug,title,content,categories,featured_media"),
    getAll("pages", "id,date,modified,slug,title,content,parent"),
    getAll("categories", "id,name"),
    getAll("media", "id,source_url"),
  ]);
  const catName = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const mediaUrl = Object.fromEntries(media.map((m) => [m.id, m.source_url]));

  for (const p of posts) {
    const featured = mediaUrl[p.featured_media];
    await writeEntry(path.join(OUT, "posts"), `${p.date.slice(0, 10)}-${p.slug}.md`, {
      title: yamlString(p.title.rendered),
      date: p.date.slice(0, 10),
      wp_category: yamlString(p.categories.map((id) => catName[id] || id).join(", ")),
      image: featured ? rewriteUploads(featured) : undefined,
      wp_id: p.id,
    }, p.content.rendered);
  }

  for (const p of pages) {
    await writeEntry(path.join(OUT, "pages"), `${p.slug || p.id}.md`, {
      title: yamlString(p.title.rendered),
      wp_last_modified: p.modified.slice(0, 10),
      wp_id: p.id,
    }, p.content.rendered);
  }

  // Also grab media that isn't referenced from any post or page (PDFs often aren't).
  for (const m of media) rewriteUploads(m.source_url);

  const failures = [];
  let downloaded = 0;
  if (!SKIP_MEDIA) {
    const list = [...wanted];
    console.log(`Downloading ${list.length} files …`);
    for (const rel of list) {
      try {
        if ((await download(rel)) === "downloaded") downloaded++;
      } catch (e) {
        failures.push({ file: rel, error: e.message });
      }
    }
  }

  const report = {
    source: WP,
    posts: posts.length,
    pages: pages.length,
    media_referenced: wanted.size,
    media_downloaded: downloaded,
    failures,
  };
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(report);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
