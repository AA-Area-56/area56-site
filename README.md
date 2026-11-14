# Area 56 website

The website for Southwest Ohio General Service Area 56. It's a static site built with [Eleventy](https://www.11ty.dev). Trusted servants edit it through [Pages CMS](https://pagescms.org): a web editor with simple forms, so nobody needs to know Git, HTML, or Markdown.

## How it fits together

```
Officer edits in Pages CMS ──► commit to GitHub ──► GitHub Actions rebuilds (≈1–2 min) ──► GitHub Pages ──► aaarea56.org
```

- **Content** lives in `src/` as Markdown and JSON files, one folder per type:
  | Folder | Editor sees | Shows up at |
  |---|---|---|
  | `src/announcements/` | Announcements | Home page (newest 4), `/announcements/` |
  | `src/delegates-corner/` | Delegate's Corner | Home page (latest), `/delegates-corner/` |
  | `src/events/` | Events | Home page (next 5), `/events/` |
  | `src/documents/` | Documents | `/documents/`, grouped by category |
  | `src/mini-conference/` | Mini-Conference | `/mini-conference/` |
  | `src/_data/servants.json` | Trusted servants | `/trusted-servants/` |
  | `src/_data/site.json` | Site settings | Footer, Contribute, Contact, home help links |
  | `src/pages/` | Pages | `/<file-name>/` |
- **Design** lives in `src/_includes/` and `src/css/`. Editors can't reach it, so the site keeps looking consistent.
- **Editor forms** are defined in `.pages.yml`.
- **Past events** are hidden by `src/js/upcoming.js` in the browser. A nightly rebuild also keeps the lists current (`.github/workflows/deploy.yml`, which also deploys on every push).

## Run it locally

```sh
npm install
npm start          # http://localhost:8080
```

## Going live

1. Create a GitHub organization for the Area (for example `aaarea56`) and push this repo to it.
2. In the repo's Settings → Pages, set Source to **GitHub Actions**. The build is defined in `.github/workflows/deploy.yml`.
3. In the same screen, set the custom domain to `aaarea56.org` and point the domain's DNS at GitHub Pages ([instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)). Turn on "Enforce HTTPS" once the certificate is issued.
4. Install the Pages CMS GitHub App on the organization ([app.pagescms.org](https://app.pagescms.org)).

## Editor accounts: one per position, not per person

Make a GitHub account for each position that edits the site, signed up with that position's role email (for example `communications@aaarea56.org` or `delegate@aaarea56.org`). Add those accounts to the GitHub organization.

At rotation, the outgoing trusted servant hands over the role email. The incoming one uses "Forgot password" on GitHub with that email, and they're in. Nobody has to make a personal account, and the list of editors stays the same from panel to panel.

## Moving content from WordPress

`scripts/migrate-from-wordpress.mjs` reads a WordPress export file (in WordPress, **Tools → Export → All content**). It writes published posts, pages, and calendar events to `migration/` as Markdown and downloads the site's uploaded files to `src/uploads/wp/`. It doesn't touch anything else in `src/`, so you can review what came over and move what's worth keeping into the right folder. `migration/report.json` lists any failed downloads and the pages a person should compare by hand.

The export also holds drafts, private posts, and author emails, so `.gitignore` keeps it out of the repo. Save it in the project folder or pass its path:

```sh
npm run migrate                       # newest *.WordPress.*.xml in this folder
npm run migrate -- path/to/export.xml
npm run migrate -- --no-media         # Markdown only, skip downloads
```

Everything in `src/uploads/` gets published, and the script downloads the whole media library, including files nothing links to. Before committing, keep only the files the site uses in `src/uploads/wp/`, and check them for names or contact details. Files you don't need can go in `migration/`, which Git ignores.
