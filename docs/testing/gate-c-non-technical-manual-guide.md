# Non-technical end-to-end testing guide

**Status:** Ready to use after developer setup; full completion is currently blocked by known invitation and local-startup issues.

**Audience:** A client, product manager, operations person, or other tester who should use only the browser.

**Notion mirror:** https://app.notion.com/p/3a4e5c7c2b8e81a8949cff0b321b04fc

**Developer setup:** [Local environment setup for manual end-to-end testing](gate-c-local-environment-setup.md)

**Developer setup in Notion:** https://app.notion.com/p/3a4e5c7c2b8e8197b2daf950431552b3

You do not need Terminal, code, D1, DevTools, Playwright, or technical API knowledge. Follow the screens exactly as a client would. If anything differs, stop that section and write down what happened.

## Before you start

Ask the developer for:

- the test URL, normally `http://localhost:5173`;
- a browser profile already prepared for Root;
- separate Admin, Operator, and Viewer browser profiles when invitation onboarding is available;
- access to the three test inboxes, or a developer who will open local one-time links in the correct profile;
- confirmation that this is a fresh test environment;
- the list of known blockers for this test run.

Use only this synthetic data:

| Purpose | Value |
| --- | --- |
| Root | `root@gate-c.example` |
| Admin | `admin@gate-c.example` |
| Operator | `operator@gate-c.example` |
| Viewer | `viewer@gate-c.example` |
| Clients | `Gate C Alpha`, `Gate C Beta` |
| Customer | `gate-c-customer` |
| Main Promo | `gate-c-promo` |
| Free-shipping Promo | `gate-c-free-shipping` |

Never use real customer names, emails, attributes, products, or commercial terms.

## How to record each section

Choose one result:

- **Pass** — every expected result appeared.
- **Fail** — the screen behaved differently.
- **Blocked** — an earlier failure made this impossible.
- **Not tested** — you deliberately did not run it.

For a failure, record:

```text
Section:
What I clicked:
What I expected:
What actually happened:
Exact message shown:
Can I repeat it: Yes / No
Screenshot attached: Yes / No
```

Never capture activation grants, recovery codes, one-time links, cookies, or credential tokens in a screenshot or recording.

## 1. Root sign-in and client selection

Use the Root browser profile.

1. Open the test URL.
2. If asked, select **Sign in with passkey** and complete the browser prompt.
3. Confirm a purple banner says **Root access**.
4. Before selecting a client, open **Clients** in the left menu.
5. Enter `Gate C Alpha` in **Client name** and select **Provision client**.
6. Wait until `Gate C Alpha` shows **Active** and has a **Select Gate C Alpha** button.
7. Repeat for `Gate C Beta`.
8. Select **Select Gate C Alpha**.
9. Confirm the purple banner says `Root access · Gate C Alpha`.
10. Refresh the browser. Confirm the banner still says Alpha.
11. Return to **Clients**, select **Select Gate C Beta**, then refresh again.
12. Confirm the banner now says Beta and does not show Alpha as current.

Expected result:

- both clients become Active;
- selection survives refresh;
- switching changes the current client everywhere;
- Root remains visibly identified as Root.

Record: **Pass / Fail / Blocked / Not tested**.

## 2. Invite and sign in as the client Admin

This section is currently expected to be blocked by the known invitation issue until it is fixed.

1. While Root has `Gate C Beta` selected, open **Team**.
2. Enter `admin@gate-c.example` in **Invite email**.
3. Choose `admin` in **Invite role**.
4. Select **Invite user**.
5. Confirm the invitation appears in the list and is marked sent/pending rather than failed.
6. In the separate Admin browser profile, open the invitation email/link provided by the developer.
7. Confirm the page says **Accept invitation**.
8. Enter `admin@gate-c.example` in **Invited email** and select **Accept invitation**.
9. Confirm the page says the invitation was accepted, then select **Sign in**.
10. Enter `admin@gate-c.example` in **Work email** and select **Email me a sign-in link**.
11. Open the new sign-in link in the same Admin profile.
12. Confirm the dashboard opens and there is no Root banner.

Expected result:

- the real invitation and sign-in flow works without a password;
- the Admin enters only the `Gate C Beta` company;
- one-time links disappear after use and cannot be reused.

If **Invite user** shows **Request validation failed**, record **Fail**, reference the known invitation blocker, and mark Sections 3 and 8 role checks **Blocked**.

Record: **Pass / Fail / Blocked / Not tested**.

## 3. Admin invites Operator and Viewer

Use the Admin profile.

1. Open **Team**.
2. Invite `operator@gate-c.example` with role `operator`.
3. Invite `viewer@gate-c.example` with role `viewer`.
4. Complete each invitation and email sign-in in its own separate browser profile, following the same steps as the Admin.
5. Return to Admin **Team**.
6. Confirm all three members are Active and have the correct role.

Expected result: Admin can add company users, and every user is isolated in its own signed-in profile.

Record: **Pass / Fail / Blocked / Not tested**.

## 4. Define the client data types

Use Root with Beta selected, Admin, or Operator.

1. Open **Variables**.
2. Select **New variable**.
3. Enter:
   - Key: `customer.tier`
   - Label: `Tier`
   - Source: `customer`
   - Type: `enum`
   - Enum values: `bronze, silver, gold`
   - Required: ticked
4. Select **Save variable**.
5. Create another variable:
   - Key: `context.channel`
   - Label: `Channel`
   - Source: `context`
   - Type: `enum`
   - Enum values: `web, mobile`
   - Required: ticked
6. Select **Impact customer.tier**, then **Impact context.channel**.
7. Confirm the page shows impact information before any removal.
8. Select **Publish schema**.
9. Confirm **Published version 1** appears.
10. Refresh and confirm both variables and Published version 1 remain.
11. In the `context.channel` row, select **Delete**.
12. Confirm the page offers **Confirm deprecate context.channel** rather than deleting immediately.
13. Confirm the deprecation.

Expected result: the client defines types in the UI, publication survives refresh, and a published field cannot disappear without impact/deprecation confirmation.

Record: **Pass / Fail / Blocked / Not tested**.

## 5. Create and update a customer

Use Root with Beta selected, Admin, or Operator.

1. Open **Customers**.
2. Enter `gate-c-customer` in **Customer reference**.
3. Select **Look up customer**.
4. Confirm the page says **No customer exists for this exact reference.**
5. Choose `gold` for **Tier**.
6. Select **Create customer**.
7. Confirm **Version 1** appears.
8. Change Tier to `silver` and select **Save customer**.
9. Confirm **Version 2** appears.
10. Refresh the browser, look up `gate-c-customer` again, and confirm Tier is still `silver` at Version 2.

Expected result: the exact reference is used, the field is a typed dropdown, and saved values/versions survive refresh.

Record: **Pass / Fail / Blocked / Not tested**.

## 6. Check protection against two people overwriting each other

This needs two profiles with customer-management access—for example Admin and Operator. If role onboarding is blocked, mark this section **Blocked**.

1. In profile A, look up `gate-c-customer`. Leave it open at the current version.
2. In profile B, look up the same customer. Leave it open at the same version.
3. In profile A, change Tier and select **Save customer**. Confirm the version increases.
4. In profile B, choose a different Tier and select **Save customer** without refreshing first.
5. Confirm profile B shows a conflict message and **Refresh customer**.
6. Select **Refresh customer**.
7. Confirm profile A's saved value is still present and was not overwritten.

Expected result: the stale second save is rejected; the system never silently loses the first person's change.

Record: **Pass / Fail / Blocked / Not tested**.

## 7. Create and publish a conditional Promo

Use Root with Beta selected, Admin, or Operator.

1. Open **Promo Codes**.
2. Select **New promo**.
3. Enter:
   - External reference: `gate-c-promo`
   - Promo name: `Gate C conditional rewards`
4. Select **Use complete authoring example**.
5. Confirm the editor now contains:
   - a large-basket condition;
   - a nested `customer.tier = gold` condition;
   - more than one ordered reward rule;
   - a fallback reward.
6. Confirm the reward types include:
   - **Order percent** for one rule;
   - **Line item fixed** for another rule;
   - **Order fixed** for the fallback.
7. Select **Save draft**.
8. Confirm **Draft revision 1** appears.
9. Select **Publish revision**.
10. Confirm **Active revision 1** appears.
11. Refresh, reopen the Promo, and confirm its conditions, reward order, fallback, and Active revision 1 remain.

Expected result: different conditions can select different rewards in order, with a fallback when none matches.

Record: **Pass / Fail / Blocked / Not tested**.

## 8. Edit the same Promo into revision 2

1. Open `gate-c-promo` and select **Edit Promo**.
2. Confirm the External reference cannot be changed.
3. Change the name to `Gate C conditional rewards revision 2`.
4. Select **Move reward rule 2 up**.
5. Change that rule from **Line item fixed** to **Line item percent**.
6. Keep a valid product reference and percentage/basis-points value.
7. Select **Save draft**.
8. Confirm **Draft revision 2** and **Active revision 1** both appear.
9. Refresh and confirm both still appear.
10. Select **Publish revision**.
11. Confirm **Active revision 2** appears.
12. Select **Pause Promo** and confirm **Paused**.
13. Select **Resume Promo** and confirm **Active**.
14. Select **End Promo**, accept the warning, and confirm **Ended**.
15. Confirm there is no Resume action after ending.

Expected result: the same Promo receives a new immutable revision; order/reward changes persist; lifecycle changes survive reload; ending is final.

Record: **Pass / Fail / Blocked / Not tested**.

## 9. Check free shipping

1. Create another Promo with External reference `gate-c-free-shipping` and name `Gate C free shipping`.
2. Use the complete example as a starting point.
3. Change one reward to **Free shipping**.
4. Keep at least one real condition on that reward.
5. Remove the fallback if it is not needed.
6. Clear the Budget currency and Budget minor units fields; free shipping must not send a monetary budget.
7. Save and publish.
8. Refresh and confirm the Free shipping reward remains.
9. End the Promo after checking it.

Expected result: Free shipping works as a reward without amount fields or a monetary budget.

Record: **Pass / Fail / Blocked / Not tested**.

## 10. Check what each role can see and do

Use the separate role profiles. Do not change roles while checking them.

### Admin

Confirm Admin can see and use:

- Team and Credentials;
- Variables, Customers, and Promo Codes;
- create/publish/edit controls.

Confirm Admin cannot open Clients/platform management.

### Operator

Confirm Operator can see and manage:

- Variables;
- Customers;
- Promo Codes.

Confirm Team, Credentials, and Clients are absent. If you manually enter those page addresses, the page must say there is no permission.

### Viewer

Confirm Viewer can read:

- Variables;
- Promo Codes.

Confirm Viewer cannot see Customers, Team, Credentials, or Clients. Confirm **New variable**, **Publish schema**, **New promo**, **Save draft**, **Publish revision**, **Pause Promo**, and **End Promo** are absent.

Expected result: each profile sees only the screens and actions its job requires; typing a hidden page address does not bypass permission checks.

Record one result for each role: **Pass / Fail / Blocked / Not tested**.

## 11. Check a show-once credential

Use Root with Beta selected or Admin. Do not record this section on video.

1. Open **Credentials**.
2. Enter `Gate C show once` in **Credential name**.
3. Keep Kind `Secret key`, Environment `Local`, and at least one Scope selected.
4. Select **Create credential**.
5. Confirm **Copy the new token now** appears and a token is visible.
6. Do not copy or screenshot the token.
7. Select **Dismiss token**.
8. Leave Credentials, return, and refresh.
9. Confirm the list shows only a masked suffix such as `••••1234` and there is no reveal action.

Expected result: the full token is visible once only and cannot be retrieved later.

Record: **Pass / Fail / Blocked / Not tested**—without the token.

## 12. Confirm unfinished modules are clearly demo-only

Visit each page:

- Affiliates;
- Referrals;
- Loyalty;
- Events;
- Analytics.

Expected result: every page clearly shows **Demo data**. A tester must never mistake these pages for live client data.

Record: **Pass / Fail / Blocked / Not tested**.

## 13. Sign out and finish

1. In every role profile, select **Sign out**.
2. Confirm returning to the test URL shows the sign-in page.
3. Give the completed result sheet and non-sensitive screenshots to the developer.
4. Tell the developer the test is finished so the disposable environment can be removed.

Do not send one-time links, tokens, recovery codes, cookies, or real data with the report.

## Final result sheet

| Section | Result | Short note or issue ID |
| --- | --- | --- |
| 1. Root and clients |  |  |
| 2. Admin invitation/sign-in |  |  |
| 3. Operator/Viewer invitations |  |  |
| 4. Typed variables |  |  |
| 5. Customer create/update |  |  |
| 6. Customer conflict |  |  |
| 7. Promo revision 1 |  |  |
| 8. Promo revision 2/lifecycle |  |  |
| 9. Free shipping |  |  |
| 10. Admin permissions |  |  |
| 10. Operator permissions |  |  |
| 10. Viewer permissions |  |  |
| 11. Show-once credential |  |  |
| 12. Demo-only modules |  |  |
| 13. Sign-out |  |  |

The end-to-end journey passes only when every required row is **Pass**. Any **Fail**, **Blocked**, or **Not tested** means the test is incomplete and Task 10 remains blocked.
