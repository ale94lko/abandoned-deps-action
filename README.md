# 🧟 Abandoned Dependencies Checker

> Automatically audit your project dependencies and catch unmaintained or zombie packages before they become security risks.

![GitHub Action](https://img.shields.io/badge/GitHub%20Action-v1.0.2-blue?logo=githubactions) ![License](https://img.shields.io/badge/license-MIT-green)

Security bots like Dependabot alert you when a package has known vulnerabilities or new releases available. However, they fail to warn you when a dependency's maintainer completely abandons the project.

**Abandoned Dependencies Checker** solves this gap by auditing your manifest file (`package.json` or `composer.json`), checking the source repository's actual activity via the GitHub REST API, and flagging packages that haven't received updates within your specified timeframe.

---



## ⚡ Features

- **npm and Composer Support:** Audits `package.json` via the npm registry and `composer.json` via Packagist.
- **Zero Third-Party Dependencies:** Built using native Node.js (`https`, `fs`) for rapid execution and a minimal footprint.
- **Configurable Inactivity Threshold:** Define how many months without commits triggers an alert.
- **Detects Archived Repositories:** Instantly flags dependencies whose source repositories have been set to read-only/archived.
- **Detects Packagist Abandoned Packages:** Flags Composer packages explicitly marked as abandoned on Packagist.
- **GitHub Step Summary Integration:** Generates a clean Markdown table summarizing inactive dependencies directly in your workflow run overview.

---



## 📦 Supported Manifests

| Manifest         | Ecosystem | Registry  | Dependencies scanned                          |
| ---------------- | --------- | --------- | --------------------------------------------- |
| `package.json`   | npm       | npm       | `dependencies`, `devDependencies`             |
| `composer.json`  | Composer  | Packagist | `require`, `require-dev`                      |

The ecosystem is detected from the manifest filename. For Composer, platform packages such as `php`, `ext-*`, `lib-*`, and `composer-*` are skipped.

---



## 🚀 Usage

Add this workflow to your repository under `.github/workflows/check-deps.yml`.

### npm

```yaml
name: Audit Dependencies Activity

on:
  schedule:
    - cron: '0 0 * * 1'  # Run every Monday at midnight
  workflow_dispatch:     # Allow manual runs

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5

      - name: Check for abandoned dependencies
        uses: ale94lko/abandoned-deps-action@v1.0.2
        with:
          manifest-path: 'package.json'
          max-months-inactive: '12'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Composer

```yaml
name: Audit Dependencies Activity

on:
  schedule:
    - cron: '0 0 * * 1'  # Run every Monday at midnight
  workflow_dispatch:     # Allow manual runs

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5

      - name: Check for abandoned dependencies
        uses: ale94lko/abandoned-deps-action@v1.0.2
        with:
          manifest-path: 'composer.json'
          max-months-inactive: '12'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

---



## ⚙️ Inputs


| Input                 | Description                                                                     | Default               | Required |
| --------------------- | ------------------------------------------------------------------------------- | --------------------- | -------- |
| `manifest-path`       | Path to your dependency manifest (`package.json` or `composer.json`).           | `package.json`        | `false`  |
| `max-months-inactive` | Number of months without commits before marking a package as inactive.          | `12`                  | `false`  |
| `github-token`        | Token used to authenticate requests to the GitHub API (prevents rate limiting). | `${{ github.token }}` | `false`  |


---



## 📊 Example Step Summary Output

When unmaintained packages are detected, the action generates a report in your GitHub Actions Step Summary:

### ⚠️ Zombie Dependencies Warning


| Package                | Repository                                                        | Last Push  | Inactivity | Status        |
| ---------------------- | ----------------------------------------------------------------- | ---------- | ---------- | ------------- |
| **some-old-lib**       | [user/some-old-lib](https://github.com/user/some-old-lib)         | 2022-04-12 | 52 months  | 🔒 Archived   |
| **unmaintained-pkg**   | [dev/unmaintained-pkg](https://github.com/dev/unmaintained-pkg)   | 2024-01-15 | 31 months  | 💤 Inactive   |
| **vendor/old-php-lib** | [vendor/old-php-lib](https://github.com/vendor/old-php-lib)       | 2021-08-03 | 61 months  | 🚫 Abandoned  |


| Status         | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| 🔒 Archived    | The GitHub repository is archived (read-only).                          |
| 💤 Inactive    | No repository activity within `max-months-inactive`.                    |
| 🚫 Abandoned   | The Composer package is marked as abandoned on Packagist.               |


---



## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
