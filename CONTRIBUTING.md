# Contributing to Sample Room OS

You do not need to write code to contribute. Useful contributions include identifying an unnecessary operation, showing where the software differs from real work, finding repeated data entry, proposing a simpler interaction, improving documentation, testing a workflow, and implementing a change.

Before proposing a change, read [PRODUCT_PRINCIPLES.md](PRODUCT_PRINCIPLES.md). A request for more management data is not automatically a good feature if it adds routine data-entry work for frontline people.

When opening an issue or pull request, describe the real workflow and its human cost. Keep proposals focused. Do not include real customer data, production addresses, credentials, attachments, screenshots, or vendor binaries. Report security issues privately as described in [SECURITY.md](SECURITY.md).

For code changes, preserve business rules and permission boundaries unless a rule change is explicitly agreed. Run `npm run pre-pr` and the relevant Android open-source tests before submitting a pull request.
