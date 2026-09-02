# Sample Room OS Open-source Readiness

Last reviewed: 2026-09-02

## 1. Replaced product-specific branding

- Replaced the former AJY / 艾俊依 international brand name in the Web login, desktop header, worker H5 pages, Pad WebView header, browser title, and PWA application metadata with `Sample Room OS`.
- Replaced the former AJY logo SVG with a neutral, repository-owned `Sample Room OS` placeholder mark.
- Renamed the Android and Pad launcher labels, plus the WeChat mini-program title and login/home branding, to `Sample Room OS`.
- Updated the root README and mobile app READMEs to use the open-source product name. Worker Matters is identified as the open-source organization in the root README only.
- Replaced the former branded development entry code with a neutral demonstration code. This affects development/manual-acceptance configuration only, not formal authentication.

## 2. Remaining organization-specific information

No real customer, order, production-business, or production-server data was found in the current working files reviewed for this task.

The repository still contains historical acceptance records, archived UI-reference material, screenshots, and the authoritative business-rules document that use earlier product wording or contain local-worktree paths. They are historical material rather than runtime configuration. They should be reviewed, removed from the public release, or rewritten in a separate documentation-history task before publication; this task intentionally did not rewrite historical records or the SSOT.

Runtime endpoints and storage locations are already environment variables or local configuration inputs. The committed `.env.example` files use placeholders and do not contain real service addresses.

## 3. Secret review

No committed `.env` file, private key, certificate, or obvious live API/JWT/database credential was found in the current tracked files reviewed. The Git-history pattern check found no private-key, certificate, or common hosted-token signature.

Known non-secret test/demo credentials and developer entry codes exist in source and historical material. They must remain limited to development/test modes and must never be used for a deployed system. Their presence is not evidence of a production-secret leak.

## 4. Third-party license review

The root project currently has no top-level open-source license file. A license must be selected and added before public release.

The JavaScript dependencies are standard npm packages, but a full dependency-license inventory has not been generated in this lightweight review. Jingchen/NIIMBOT B1 remains the reference printer integration, but its installer and Android SDK binaries are excluded from the repository. Users must obtain them directly from the vendor; see `docs/integrations/JINGCHEN_NIIMBOT_B1.md`.

## 5. Required work before making the repository public

1. Decide whether to remove or sanitize archived documentation, acceptance screenshots, and Git history containing old branding, local paths, and test credentials.
2. Add a repository license, copyright/notice policy, contribution guidance, and security-reporting contact.
3. Keep Jingchen installer and Android SDK binaries out of the public repository unless written redistribution permission is obtained.
4. Perform a release-time secret scan on the final branch, including all reachable history, with a dedicated secret-scanning tool; rotate anything that scan flags as live.
5. Review deployment examples one final time with the actual release branch to ensure no real domain, IP, storage path, signing configuration, or customer artifact was added after this audit.

## 6. Recommendation

The runtime product branding is now suitable for the **open-source release preparation stage**, but the repository is **not yet recommended to be made public** until the license, bundled-binary redistribution, historical-documentation, and final-history secret-scan items above are resolved.
