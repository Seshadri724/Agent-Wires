// Decoy file templates. Realistic enough that a targeted read looks
// worthwhile to an attacker/injected-agent, but structurally inert.
// docs/PRD.md R1-R6, docs/ARCHITECTURE.md §3.1.

export interface DecoyTemplate {
  relativePath: string;
  density: "light" | "standard" | "paranoid";
  render(token: string): string;
}

const DECOY_LABEL =
  "# canarywatch decoy — this file is a security tripwire, not a real credential.\n" +
  "# Reading or using it triggers an alert. See https://github.com/ (canarywatch) for details.\n";

export const TEMPLATES: DecoyTemplate[] = [
  {
    relativePath: ".env.backup",
    density: "light",
    render: (t) =>
      `${DECOY_LABEL}DATABASE_URL=postgres://admin:CanaryPW_${t}@prod-db.internal:5432/app\n` +
      `STRIPE_SECRET_KEY=sk_live_${t}\n` +
      `JWT_SECRET=${t}\n`,
  },
  {
    relativePath: ".aws/credentials.decoy",
    density: "standard",
    render: (t) =>
      `${DECOY_LABEL}[default]\n` +
      `aws_access_key_id=AKIA${t.slice(0, 16).toUpperCase()}\n` +
      `aws_secret_access_key=${t}\n`,
  },
  {
    relativePath: "id_rsa_old",
    density: "standard",
    render: (t) =>
      `${DECOY_LABEL}-----BEGIN OPENSSH PRIVATE KEY-----\n` +
      Buffer.from(`canarywatch-decoy-${t}`).toString("base64") +
      `\n-----END OPENSSH PRIVATE KEY-----\n`,
  },
  {
    relativePath: "secrets/secrets.yaml",
    density: "standard",
    render: (t) =>
      `${DECOY_LABEL}api_key: "${t}"\n` + `admin_password: "Sup3rSecret_${t}"\n` + `webhook_secret: "${t}"\n`,
  },
  {
    relativePath: "exports/customers-export.csv",
    density: "paranoid",
    render: (t) =>
      `id,email,ssn,token\n` + Array.from({ length: 5 }, (_, i) => `${i},decoy${i}@example.com,000-00-000${i},${t}`).join("\n") + "\n",
  },
  {
    relativePath: "config/credentials.json.decoy",
    density: "paranoid",
    render: (t) =>
      JSON.stringify(
        { _comment: "canarywatch decoy", clientId: t, clientSecret: `secret_${t}`, refreshToken: t },
        null,
        2
      ) + "\n",
  },
];

export function templatesForDensity(density: "light" | "standard" | "paranoid"): DecoyTemplate[] {
  const order = { light: 0, standard: 1, paranoid: 2 };
  return TEMPLATES.filter((t) => order[t.density] <= order[density]);
}
