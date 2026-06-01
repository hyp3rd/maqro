/** Centralized external links — keeps the GitHub URL in one place
 *  rather than scattered across the footer, bug-report form, and the
 *  OFF User-Agent string. Update here when the canonical URL changes. */
export const GITHUB_REPO_URL = "https://github.com/hyp3rd/macro-calculator";

/** Build a pre-filled GitHub "new issue" URL. Title and body are URL-
 *  encoded; labels are comma-separated. Length is capped (~7 KB) because
 *  some browsers truncate very long query strings — most issues fit
 *  comfortably under that ceiling. */
export function buildIssueUrl(opts: {
  title: string;
  body: string;
  labels?: string[];
}): string {
  const params = new URLSearchParams();
  // Trim title to keep the URL well under ~8 KB even with a verbose body.
  params.set("title", opts.title.slice(0, 200));
  params.set("body", opts.body.slice(0, 7_000));
  if (opts.labels && opts.labels.length > 0) {
    params.set("labels", opts.labels.join(","));
  }
  return `${GITHUB_REPO_URL}/issues/new?${params.toString()}`;
}

/** URLs that route to the YAML issue-template chooser (see
 *  `.github/ISSUE_TEMPLATE/`). GitHub's `?template=name.yml` query
 *  pre-selects the matching template form. Used from the About page
 *  and footer so users land in the right structured form instead of
 *  a blank issue body. */
export const FEATURE_REQUEST_URL = `${GITHUB_REPO_URL}/issues/new?template=feature_request.yml`;
export const BUG_REPORT_URL = `${GITHUB_REPO_URL}/issues/new?template=bug_report.yml`;
export const ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

/** Public social handle for service-status announcements. Kept here
 *  so /status, /about, and any future surface point at the same
 *  account without each hard-coding the URL. */
export const TWITTER_URL = "https://x.com/maqro_app";
export const TWITTER_HANDLE = "@maqro_app";

/** Maintainer's LinkedIn — surfaced on /about under socials so
 *  prospective users (and recruiters checking on the open-source
 *  side project) can reach the human behind the app. */
export const LINKEDIN_URL = "https://www.linkedin.com/in/francesco-cosentino/";
