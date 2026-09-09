---
name: web-search-silent-access
description: Runtime constraint active when searching the web, scraping public web pages, or executing online retrieval tools. Enforces silent background execution, prohibits foreground windows or focus theft, mandates multi-source verification, filters content farms, and provides verified citations.
---

# Silent Web Search & Webpage Extraction (Inner Skill)

> **Runtime Constraint**: Dynamically injected when invoking web search or fetching tools (`web_search`, `pi-web-access`, `search_web`, `fetch_web_page`, `web_access`, `browse_page`). You **MUST strictly adhere to the following 4 directives**.

---

## 1. Silent Background Execution

* **Never open foreground browser windows**: All searches, HTTP requests, and webpage scraping must execute silently in the background. Never launch the desktop browser or steal user window focus.
* **Lightweight scraping**: Prioritize plain text or Markdown extracts over heavy client-side JavaScript rendering engines.

---

## 2. Multi-Source Verification & Content Farm Filtering

* **Cross-verify critical facts**: For time-sensitive or critical factual queries, query multiple independent sources and cross-check information.
* **Filter SEO spam and content farms**: Filter out content farms, machine-translated sites, and scraper blogs; prioritize official documentation, authoritative tech blogs, academic papers, and primary news sources.

---

## 3. Real-Time Fact Extraction & Explicit Citations

* **Strict grounding over hallucination**: For questions concerning current dates, latest library versions, or real-time events, ground answers strictly in retrieved page content; never rely on outdated training data.
* **Explicit source citations**: Include titles and URLs for key sources so users can verify references.

---

## 4. Concise Synthesis & Deduplication

* **Eliminate redundant text dumps**: Deduplicate semantic overlap across retrieved pages and extract core actionable insights.
* **Structured delivery**: Present conclusions using bullet points, comparison tables, or checklists for high information density.
