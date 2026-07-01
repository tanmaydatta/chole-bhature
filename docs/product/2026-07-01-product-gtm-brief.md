# Incentives & Targeting Platform — Product & GTM Brief

**Date:** 2026-07-01 · **Lens:** Product / Marketing (non-technical companion to the engineering MVP spec) · **Audience:** internal (product, marketing, founders)

> One-liner: **The incentives layer for any online business — run referrals, discounts, affiliate codes, and cashback/loyalty from one API and one dashboard, with rule-based targeting and full spend control.**

---

## The problem
Every growing online business runs incentives — a welcome discount, a refer-a-friend, affiliate codes for creators, points or cashback to bring people back. Today that means either:
- **Stitching together 3–4 point tools** (a referral app + a loyalty app + a discount/coupon tool + a spreadsheet of affiliate codes) that don't share customer data, targeting, or budget; or
- **Building it in-house** — weeks of engineering per program, then ongoing maintenance, and marketing still has to file a ticket for every new campaign.

The result: incentives are slow to launch, hard to target to the right customers, easy to overspend on, and impossible to measure in one place.

## What it is
An **API-first incentives platform**. A business integrates it **once**, then its **growth/marketing team runs every incentive program from a no-code dashboard** — no engineering per campaign. Four program types on one shared engine:

| Program | In plain terms |
|---|---|
| **Promo / discounts** | Coupon codes and automatic discounts, with conditions ("15% off first order over $50"). |
| **Affiliate codes** | Generate hundreds of unique codes for partners/creators/employees, hand them a CSV, track each one. |
| **Referral** | Refer-a-friend: reward both sides, and the system auto-picks which offer a customer gets based on their profile. |
| **Loyalty / cashback** | Earn points or cashback on events (e.g. a completed order), credited to a wallet, redeemed automatically. |

The differentiator underneath all four: a **rule-based targeting engine** (who's eligible, what they get, on what conditions) plus **built-in budget/usage caps** so finance never gets a surprise.

## Who it's for (ICP + personas)
**ICP (MVP):** mid-market online businesses that **own their checkout** — custom/headless storefronts, marketplaces, subscription/DTC brands, and non-Shopify platforms — with a small engineering team able to do a one-time integration and a real need for growth incentives. *(Shopify-native merchants are deliberately a later phase; MVP is platform-agnostic via API.)*

**Personas:**
- **Growth / Marketing lead (primary buyer + daily user):** wants to launch and tweak campaigns fast, target segments, and see what's working — without eng. Our dashboard is for them.
- **Engineer (technical champion):** integrates the API once, wants clean docs and to never touch it again per-campaign. Our API + reference integration are for them.
- **Finance / founder (economic buyer):** cares about ROI and controlling incentive spend. Our budget caps + unified analytics are for them.

## Jobs-to-be-done (use cases in business terms)
- "Give every first-time buyer 15% off — but cap it at $10k this month." → **Promo + budget cap.**
- "Hand 20 creators 500 unique codes each and see which creator drives sales." → **Affiliate + attribution.**
- "Reward customers who refer friends, and give VIPs a better offer automatically." → **Referral + targeting/priority.**
- "Give 5% cashback on every order, redeemable next time." → **Loyalty/cashback wallet.**

## Value proposition (why us)
- **One integration, every incentive** — stop stitching tools; one API, one dashboard, one source of truth on customers + spend.
- **Marketing moves without engineering** — new campaigns are config, not a dev ticket.
- **Right offer, right customer** — rule-based targeting instead of blunt, one-size coupons.
- **Spend under control** — budget/usage caps built in; unified reporting across all programs.
- **Own your incentives** — not locked to one storefront platform; works with your stack.

## Positioning
> "**Twilio for incentives**": the programmable layer businesses build referrals, discounts, affiliate, and cashback on — instead of gluing together single-purpose apps or building it themselves.

- **vs. point solutions** (separate referral / loyalty / coupon tools): we unify them + share targeting, customers, and budget.
- **vs. build-in-house**: live in days, not quarters; no maintenance burden.
- **vs. platform-locked apps** (e.g. Shopify-only): API-first and platform-agnostic — you're not boxed into one storefront.

## Pricing (direction, not final)
SaaS **subscription tiers** (flat plans for MVP; usage/value-based metering later). Tiers gate program types, volume, and dashboard seats. Free trial to drive activation. *(Detailed packaging is a fast-follow once design partners validate willingness-to-pay.)*

## Go-to-market (sketch)
- **Motion:** product-led for the API/dev entry (great docs + reference integration + free trial) layered with founder-led sales to the first design partners and mid-market accounts.
- **Beachhead:** non-Shopify, checkout-owning DTC/marketplace/subscription businesses that feel the multi-tool pain most.
- **Channels:** developer + growth communities, content ("how to run X without 4 tools"), and partnerships (agencies, platforms, creator networks).
- **This phase (build):** ship the MVP + a reference integration, then onboard a handful of hand-held design partners — **no broad launch or sales scaling yet** (that's the next phase).

## Success metrics
- **Activation:** time-to-first-program-live; % of signups that ship a real program.
- **Value delivered:** incentive spend managed, redemptions driven, referral/loyalty engagement.
- **Business:** design-partner conversion, retention, expansion (more program types per account), willingness-to-pay signal.

## Roadmap narrative (non-technical)
1. **Now — Build (3 months):** the four programs working end-to-end via API + dashboard, proven on a reference storefront.
2. **Design partners:** onboard a few real businesses, learn, harden.
3. **GA + self-serve:** open signup, polished onboarding, docs, support.
4. **Platform connectors:** Shopify/Woo/etc. one-click integrations to widen the market.
5. **Depth:** advanced targeting/segments, richer analytics/experimentation, fraud controls.

## Key assumptions & risks (PM lens)
- **Assumption:** businesses feel the multi-tool/DIY pain enough to adopt an incentives *platform* (vs. another point app). → validate with design partners early.
- **Assumption:** an API-first, own-your-checkout ICP is reachable without a storefront-marketplace channel. → test GTM channels in parallel with build.
- **Risk:** "platform" scope creep — MVP intentionally caps program depth and excludes fraud + connectors to ship in 3 months.

---
*Companion to the engineering spec ("Incentives Engine MVP — Design Spec"). This brief is the product/marketing framing; external copy (landing page, one-pager, pitch) can be derived from the Positioning + Value proposition sections.*
