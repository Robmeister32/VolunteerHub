# Background Check Verification Flow

This flow shows how a volunteer moves from registration through verification and final admin approval.

```mermaid
flowchart LR
  subgraph Volunteer
    A["Register account"]
    B["Log in"]
    C["Complete volunteer application"]
    D["Provide background check consent"]
    E["Receive status updates"]
    F["Access volunteer dashboard"]
  end

  subgraph VolunteerHub
    G["Create applicant profile"]
    H["Save application"]
    I["Set status: Submitted"]
    J["Verify consent is on file"]
    K["Update verification status"]
    L["Activate volunteer account"]
  end

  subgraph AI["AI Workflow Agent"]
    M["Check application completeness"]
    N{"Missing information?"}
    O["Notify applicant or admin"]
    P["Start background check workflow"]
    Q["Track vendor status"]
    R["Summarize result for admin review"]
  end

  subgraph Provider["Background Check Provider"]
    S["Receive screening request"]
    T["Run identity and background checks"]
    U["Return result"]
  end

  subgraph Admin
    V["Review application"]
    W["Review verification summary"]
    X{"Approve volunteer?"}
    Y["Approve"]
    Z["Reject or request follow-up"]
  end

  A --> G
  B --> C
  C --> H
  H --> I
  D --> J
  I --> M
  J --> M
  M --> N
  N -- "Yes" --> O
  O --> E
  E --> C
  N -- "No" --> P
  P --> S
  S --> T
  T --> U
  U --> Q
  Q --> K
  K --> R
  R --> V
  V --> W
  W --> X
  X -- "Yes" --> Y
  Y --> L
  L --> F
  X -- "No" --> Z
  Z --> E
```

## Demo Talking Point

The AI workflow agent does not approve or reject volunteers. It checks completeness, starts the background-check workflow, tracks status, summarizes results, and routes the application to an administrator. The final decision stays with a human reviewer.
