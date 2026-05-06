# Rasumi Group — Corporate Website

## Project Overview
Official corporate website for **Rasumi Group (Rasumi Medipharma Sdn Bhd)**, a healthcare logistics and procurement company operating across Malaysia, serving Ministry of Defence healthcare facilities and the private sector since 2006.

---

## Folder Structure

```
website/
├── index.html              — Main homepage (scroll-snap multi-section)
├── legal.html              — Legal hub (Terms, Privacy, Disclaimer, Compliance sections)
├── about/index.html        — About subpage
├── services/index.html     — Services subpage
├── contact/index.html      — Contact subpage
├── legal/index.html        — Redirect to ../legal.html
│
├── assets/
│   ├── css/
│   │   ├── themes.css      — CSS variables (:root + [data-theme="dark"])
│   │   ├── style.css       — Base component styles
│   │   └── responsive.css  — @media query breakpoints
│   ├── js/
│   │   ├── main.js         — Navbar scroll, smooth scroll, theme toggle
│   │   ├── animations.js   — IntersectionObserver + network grid animation
│   │   └── form.js         — Contact form logic (placeholder)
│   ├── images/
│   │   ├── team/           — Staff and team photos
│   │   ├── icons/          — Logo icons (day_icon.png, dark_icon.png)
│   │   └── bg/             — Background images (background.png, bg.jpg, etc.)
│   └── fonts/              — Custom fonts (if any)
│
├── components/
│   ├── header.html         — <head> block reference
│   ├── navbar.html         — <nav> block reference
│   └── footer.html         — <footer> block reference
│
├── backend/
│   └── send-mail.php       — PHP contact form mailer (to be implemented)
│
├── config/
│   └── site-config.js      — Site-wide constants (name, contact, legal links)
│
├── seo/
│   ├── sitemap.xml         — XML sitemap for search engines
│   └── robots.txt          — Crawler instructions
│
├── .htaccess               — Apache routing + cache headers
└── README.md               — This file
```

---

## Legal Pages

`legal.html` contains **four sections** accessible via anchor IDs:

| Section | Anchor |
|---|---|
| Terms & Conditions | `legal.html#terms` |
| Privacy Policy | `legal.html#privacy` |
| Website Disclaimer | `legal.html#disclaimer` |
| Compliance & Security (ISMS) | `legal.html#compliance` |

Footer links in all pages point to these anchors directly.

---

## Headquarters

**Rasumi Medipharma Sdn Bhd**  
No 162, Jalan S2 B22, Pusat Dagangan Seremban 2  
70300 Seremban, Negeri Sembilan  
📞 06-601 2918  
📧 info@rasumigroup.my
