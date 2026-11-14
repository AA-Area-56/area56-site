import { HtmlBasePlugin } from "@11ty/eleventy";

export default function (eleventyConfig) {
  // Rewrites root-relative URLs (/css/..., /announcements/) to include the
  // path prefix, so the site works when served from a subpath like
  // https://aa-area-56.github.io/area56-site/
  eleventyConfig.addPlugin(HtmlBasePlugin);

  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/uploads": "uploads" });

  const fmt = (d, opts) =>
    new Date(d).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });

  eleventyConfig.addFilter("readableDate", (d) =>
    fmt(d, { year: "numeric", month: "long", day: "numeric" })
  );
  eleventyConfig.addFilter("monthYear", (d) => fmt(d, { year: "numeric", month: "long" }));
  eleventyConfig.addFilter("shortMonth", (d) => fmt(d, { month: "short" }));
  eleventyConfig.addFilter("dayNum", (d) => fmt(d, { day: "numeric" }));
  eleventyConfig.addFilter("weekday", (d) => fmt(d, { weekday: "long" }));
  eleventyConfig.addFilter("isoDate", (d) => new Date(d).toISOString().slice(0, 10));
  eleventyConfig.addFilter("limit", (arr, n) => (arr || []).slice(0, n));

  const byDateDesc = (a, b) => b.date - a.date;
  const byDateAsc = (a, b) => a.date - b.date;

  eleventyConfig.addCollection("announcements", (api) =>
    api.getFilteredByGlob("src/announcements/*.md").sort(byDateDesc)
  );
  eleventyConfig.addCollection("delegatesCorner", (api) =>
    api.getFilteredByGlob("src/delegates-corner/*.md").sort(byDateDesc)
  );
  eleventyConfig.addCollection("events", (api) =>
    api.getFilteredByGlob("src/events/*.md").sort(byDateAsc)
  );
  eleventyConfig.addCollection("documents", (api) =>
    api.getFilteredByGlob("src/documents/*.md").sort(byDateDesc)
  );
  eleventyConfig.addCollection("conferences", (api) =>
    api.getFilteredByGlob("src/mini-conference/*.md").sort(byDateDesc)
  );

  return {
    pathPrefix: process.env.PATH_PREFIX || "/",
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
