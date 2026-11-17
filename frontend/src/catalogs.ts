export type CatalogId =
  | "bank-accounts"
  | "categories"
  | "subcategories"
  | "cost-centers"
  | "parties";

export type RecordData = { id: string; active: boolean } & Record<
  string,
  string | boolean | null
>;

export type Option = { value: string; label: string };

type Field = {
  name: string;
  label: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  type?: "date" | "email" | "tel";
  options?: Option[];
  reference?: CatalogId;
  pattern?: string;
  maxLength?: number;
};

type Catalog = {
  label: string;
  singular: string;
  titleField: string;
  fields: Field[];
  columns: { name: string; label: string }[];
};

const code: Field = { name: "code", label: "Código", required: true };
const name: Field = { name: "name", label: "Nome", required: true };

const dates: Field[] = [
  { name: "valid_from", label: "Início da vigência", type: "date" },
  { name: "valid_to", label: "Fim da vigência", type: "date" },
];

export const catalogs: Record<CatalogId, Catalog> = {
  "bank-accounts": {
    label: "Contas bancárias",
    singular: "conta bancária",
    titleField: "holder_name",
    fields: [
      code,
      { name: "holder_name", label: "Titular", required: true },
      { name: "bank_code", label: "Código do banco", required: true },
      { name: "branch", label: "Agência", required: true },
      {
        name: "account_number_masked",
        label: "Conta mascarada",
        placeholder: "**1234",
        pattern: "\\*{2,}[0-9]{0,4}",
        required: true,
      },
      {
        name: "currency",
        label: "Moeda",
        defaultValue: "BRL",
        pattern: "[A-Z]{3}",
        maxLength: 3,
        required: true,
      },
    ],
    columns: [
      { name: "code", label: "Código" },
      { name: "bank_code", label: "Banco" },
      { name: "account_number_masked", label: "Conta" },
    ],
  },
  categories: {
    label: "Classificações",
    singular: "classificação",
    titleField: "name",
    fields: [
      code,
      name,
      {
        name: "kind",
        label: "Natureza",
        required: true,
        options: [
          { value: "REVENUE", label: "Receita" },
          { value: "EXPENSE", label: "Despesa" },
          { value: "NEUTRAL", label: "Neutra" },
        ],
      },
      ...dates,
    ],
    columns: [
      { name: "code", label: "Código" },
      { name: "kind", label: "Natureza" },
    ],
  },
  subcategories: {
    label: "Subclassificações",
    singular: "subclassificação",
    titleField: "name",
    fields: [code, name, ...dates],
    columns: [{ name: "code", label: "Código" }],
  },
  "cost-centers": {
    label: "Centros de custos",
    singular: "centro de custos",
    titleField: "name",
    fields: [
      code,
      name,
      {
        name: "parent_id",
        label: "Centro superior",
        reference: "cost-centers",
      },
    ],
    columns: [
      { name: "code", label: "Código" },
      { name: "parent_id", label: "Centro superior" },
    ],
  },
  parties: {
    label: "Clientes e fornecedores",
    singular: "cliente ou fornecedor",
    titleField: "display_name",
    fields: [
      { name: "display_name", label: "Nome", required: true },
      {
        name: "type",
        label: "Tipo",
        required: true,
        options: [
          { value: "CUSTOMER", label: "Cliente" },
          { value: "SUPPLIER", label: "Fornecedor" },
          { value: "BOTH", label: "Cliente e fornecedor" },
        ],
      },
      { name: "tax_id", label: "CPF ou CNPJ" },
      { name: "contact_email", label: "E-mail", type: "email" },
      { name: "contact_phone", label: "Telefone", type: "tel" },
    ],
    columns: [{ name: "type", label: "Tipo" }],
  },
};

export const catalogIds = [
  "bank-accounts",
  "categories",
  "cost-centers",
  "parties",
] as const satisfies readonly CatalogId[];
