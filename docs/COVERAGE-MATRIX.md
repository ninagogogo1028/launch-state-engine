# LSE V0.1 Rule Coverage Matrix

Audited 2026-10-19. This is a registry audit, not a compliance opinion. Product Context `category` is LSE routing metadata and is **not** a WeChat official service category. The official category must still be selected and verified in the WeChat admin console.

| Area / product shape | Coverage | What LSE can honestly say | Basis |
|---|---|---|---|
| Registration, AppID, subject and service-category selection | verified | These steps belong in the general launch path. Exact category availability and qualification must be checked for the actual subject. | WeChat Mini Program introduction; official service-category list |
| Mini Program filing | verified | Filing belongs in the general production-launch path. | WeChat Mini Program filing guide |
| Core migration, preflight, device verification and final production verification | partial | These are launch-process checks, not a claim that WeChat mandates every implementation detail. | WeChat development/release guidance plus clearly labelled launch practice |
| Privacy inventory and privacy declaration | verified / conditional | The declaration path applies when the confirmed product facts use the modelled privacy-relevant capabilities. The inventory step remains launch preparation. | WeChat user-privacy guides |
| Login and first-party backend/network | verified / conditional | Login and production-backend nodes are included only when those facts are confirmed. | `wx.login` guidance; network/domain guidance |
| Subscription-message reminders | verified / conditional | Included only when reminders are confirmed. End-to-end delivery advice remains field experience. | WeChat subscription-message documentation |
| File/image selection, clipboard and location | verified / conditional | Included or excluded from confirmed capability facts; unknown remains undetermined. | WeChat privacy interface guidance |
| Public UGC text/images | partial / conditional | LSE includes governance and content-safety steps, but does not claim to cover every category, qualification or moderation obligation for every UGC business. | Official service categories, operation rules and content-security documentation |
| Virtual goods, digital content or digital entitlements | verified / conditional | The existing Virtual Payment path is triggered by the transaction object, not by a generic “paid” flag. Actual account eligibility still requires platform verification. | `wx.requestVirtualPayment` official documentation |
| Physical goods / ordinary Mini Program payment | unverified | LSE records the facts but does not provide a complete payment, order, fulfilment or after-sales checklist. It must not be read as fully covered. | WeChat Pay Mini Program onboarding and `wx.requestPayment`; acknowledged Registry boundary |
| Offline / in-person services | unverified | Recognized as a product fact; no complete specialist ruleset is claimed. | Registry boundary |
| Advertising, commission, donation/tipping and mixed monetization | unverified | Recognized as monetization facts only. No specialist requirements are inferred. | Registry boundary |
| Community/social, content, commerce, education, game and other product shapes | partial / unverified specialist requirements | The general launch path still appears, but specialist official rules and qualifications may be missing. | Registry boundary plus official service-category list |
| A conditional capability explicitly answered “no” | not applicable to that case | The corresponding modelled conditional node may be excluded with an explicit confirmed reason. This says nothing about unmodelled rule families. | Product Context fact + evaluated official rule |
| A capability left `unknown` | undetermined, not not-applicable | The path is neither included nor excluded; Dashboard asks the user to decide or confirm. | Tri-state compiler semantics |

## Interpretation

- **verified** means an existing Registry rule has a cited first-party source and a reviewed applicability condition.
- **partial** means LSE provides a general or bounded path but does not claim exhaustive specialist coverage.
- **unverified** means the Registry has not established a complete applicable rule family; absence of nodes is not evidence of absence of requirements.
- **not applicable** is case-specific and requires a confirmed fact. It is never inferred merely because a product type is outside Registry coverage.
