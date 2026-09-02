# Sample Room OS

Sample Room OS is Worker Matters' first open-source project: workflow software for garment sample rooms, designed from the perspective of frontline workers.

> Technology should adapt to people, not make people adapt to technology. Workers should benefit from software simply by doing their work.

This early open-source release (`v0.1.0`) evolved from a real garment sample-room workflow. It is not an abstract demo or a generic ERP replacement.

## What it supports today

- Formal login, role-based access, and customer accounts.
- Receiver intake, order tracking, planner visibility, and pattern-maker workflow.
- Worker H5 scan flows, boss order management, pricing, reconciliation, and controlled file access.
- Web, Worker H5, Pad WebView / Android, and WeChat mini-program clients.
- PostgreSQL schema and migrations, plus an in-memory development/test mode.

Operational data should arise from real work whenever possible, rather than asking people to enter the same facts repeatedly.

## Quick start

Requirements: Node.js 22 or later and npm. PostgreSQL is needed only for Prisma-backed development or deployment.

```powershell
Copy-Item .env.example .env
npm install
npm run pre-pr
```

For a lightweight local demonstration using in-memory persistence:

```powershell
npm run manual:formal:memory
```

`AUTH_MODE=formal` remains the normal application path. Development entry settings are for local development and test use only; do not use demonstration credentials in a deployed system.

## Configuration and deployment

Start with [`.env.example`](.env.example). It contains placeholders only; never commit a real `.env`, database password, storage location, signing material, or production address.

The repository includes Docker and factory deployment configuration, database schema, migrations, and release-building scripts. See [deployment](deployment) and [docs/current](docs/current) for detailed operational material.

## Jingchen / NIIMBOT B1 reference integration

Sample Room OS includes a reference integration for the Jingchen / NIIMBOT B1 label printer, based on a real garment sample-room deployment.

The open-source repository includes the Sample Room OS integration layer, but does not redistribute proprietary NIIMBOT/Jingchen drivers, desktop services, installers, or Android SDK binaries. Users who want to enable NIIMBOT B1 support should obtain the required software or SDK directly from the vendor's official channels. The default open-source Pad build does not require the proprietary SDK.

Jingchen / NIIMBOT names and trademarks belong to their respective owners. This reference integration does not imply partnership, certification, authorization, endorsement, or any commercial relationship.

See [the integration guide](docs/integrations/JINGCHEN_NIIMBOT_B1.md) for the PC local-service flow, optional Pad SDK build, and redistribution boundaries.

## Contributing

Contributions are welcome, including from people who do not write code. A frontline worker identifying an unnecessary step, a user spotting a mismatch between software and real work, a designer proposing a simpler operation, and a developer implementing it are all valuable contributions.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [PRODUCT_PRINCIPLES.md](PRODUCT_PRINCIPLES.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before participating.

## Security

Please do not open public issues for suspected vulnerabilities or exposed private data. Follow [SECURITY.md](SECURITY.md).

## License

Sample Room OS source code is licensed under the [Apache License 2.0](LICENSE). Third-party dependencies, assets, vendor SDKs, and examples retain their own licenses.

## Worker Matters

Worker Matters builds software around the real work people do. This project is our first open-source release and an invitation to make operational software more useful, less repetitive, and easier for frontline workers to live with.
