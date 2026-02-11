# SolAudity

**Intelligent Audit Management Platform for EVM Smart Contracts**

Solaudity is a comprehensive solution designed to streamline the lifecycle of smart contract security audits. From scope definition to final reporting, it provides a structured environment for auditors to manage their missions effectively, leveraging automated tools and manual review workflows.

<br>

## Goal

The primary goal of Solaudity is to centralize and optimize the smart contract auditing process. It aims to:
-   **Simplify Scope Management**: Easily import contracts from various sources (GitHub, Etherscan, etc.).
-   **Automate Enumeration**: Quickly visualize contract structures and dependencies.
-   **Integrate Analysis Tools**: seamless execution of static (Slither) and symbolic (Mythril) analysis.
-   **Structure Manual Reviews**: Provide checklists and finding management to ensure thoroughness.
-   **Generate Reports**: Automatically produce professional Markdown and PDF reports.

<br>

## Technical Stack

Built with modern, performance-oriented technologies.

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | ![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white) | **Vite**, **PandaCSS**, **Ark UI**, **Lucide React** for a responsive and accessible UI. |
| **Backend** | ![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=flat&logo=fastapi) ![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white) | High-performance Python API for handling logic and integrations. |
| **Analysis** | ![Slither](https://img.shields.io/badge/Slither-Integrated-success) ![Mythril](https://img.shields.io/badge/Mythril-Integrated-success) | Integration with industry-standard security tools. |
| **Deployment** | ![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white) | Containerized environment for easy setup and reproducibility. |

<br>

## Key Features

### 1. Audit Management
- **Lifecycle**: Create, list, delete, and resume audit missions.
- **Dashboard**: Centralized view of all ongoing security assessments.

### 2. Scope Definition
- **Flexible Import**:
  - `GitHub` repositories
  - `Etherscan` verified contracts
  - `Bug Bounty` platforms
  - Manual `.sol` uploads
- **Out-of-Scope**: Clearly define what is excluded from the audit.

### 3. Enumeration & Visualization
- **Parsing**: Structural analysis of contracts (Functions, Events, State Variables) via Slither.
- **Dependency Graph**: Visual representation of contract interactions.
- **Filtering**: Advanced search and filtering by visibility, modifiers, etc.

### 4. Automated Analysis
- **Static Analysis**: Run Slither automatically.
- **Symbolic Execution**: Run Mythril for deeper checks.
- **Validation**: Review findings and mark false positives.

### 5. Manual Review & Reporting
- **Checklists**: Follow standard audit methodologies.
- **Findings**: Create, tag, and associate findings with specific code.
- **Reports**: Generate publication-ready Markdown and PDF reports.

<br><br>

## Workflow

```mermaid
graph TD
    %% Styles
    classDef step fill:#161618,stroke:#3a3a3e,stroke-width:1px,color:#fff,rx:4,ry:4,text-align:center;
    classDef startend fill:#b9b9b9,stroke:none,color:#121214,rx:10,ry:10;

    %% Flow
    Start([Start]):::startend --> S1
    
    S1["<strong>Draft & Scope</strong><hr style='margin:5px -10px;border-top:1px solid #3a3a3e;opacity:0.5;'/><span style='font-size:0.9em'>- GitHub / Etherscan<br/>- Manual Upload<br/>- Out-of-Scope config</span>"]:::step
    S1 --> S2
    
    S2["<strong>Enumeration</strong><hr style='margin:5px -10px;border-top:1px solid #3a3a3e;opacity:0.5;'/><span style='font-size:0.9em'>- AST Parsing<br/>- Dependency Graph<br/>- Function visibility</span>"]:::step
    S2 --> S3
    
    S3["<strong>Automated Analysis</strong><hr style='margin:5px -10px;border-top:1px solid #3a3a3e;opacity:0.5;'/><span style='font-size:0.9em'>- Slither (Static)<br/>- Mythril (Symbolic)<br/>- False Positive filtering</span>"]:::step
    S3 --> S4
    
    S4["<strong>Manual Review</strong><hr style='margin:5px -10px;border-top:1px solid #3a3a3e;opacity:0.5;'/><span style='font-size:0.9em'>- Audit Checklist<br/>- Finding Association<br/>- Vulnerability Tagging</span>"]:::step
    S4 --> S5
    
    S5([Reporting]):::startend
```

<br><br>

## Getting Started

### Prerequisites
*   [Docker](https://www.docker.com/) and Docker Compose installed.

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/yourusername/solaudity.git
    cd solaudity
    ```

2.  **Start in Development Mode**
    Runs the backend and frontend with live reload.
    ```bash
    ./start.sh dev
    ```
    -   Frontend: [http://localhost:5173](http://localhost:5173)
    -   Backend: [http://localhost:8001](http://localhost:8001)

3.  **Start in Production Mode**
    ```bash
    ./start.sh prod
    ```