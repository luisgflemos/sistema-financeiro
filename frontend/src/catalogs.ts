import banks from "./banks.json";
import { currencies } from "./currencies";

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
  readOnly?: boolean;
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

const code: Field = {
  name: "code",
  label: "Código",
  readOnly: true,
  placeholder: "Gerado automaticamente ao salvar",
};
const name: Field = { name: "name", label: "Nome", required: true };

const description: Field = { name: "description", label: "Descrição" };

export const catalogs: Record<CatalogId, Catalog> = {
  "bank-accounts": {
    label: "Contas Bancárias",
    singular: "conta bancária",
    titleField: "label",
    fields: [
      { name: "label", label: "Nome da conta", required: true },
      {
        name: "bank_code",
        label: "Banco",
        required: true,
        options: banks,
      },
      {
        name: "holder_document",
        label: "CPF/CNPJ do titular",
      },
      { name: "branch", label: "Agência", required: true },
      {
        name: "account_number",
        label: "Número da conta",
        required: true,
        pattern: "[0-9]{1,20}",
      },
      {
        name: "account_digit",
        label: "Dígito da conta",
        pattern: "[0-9Xx]{1,2}",
      },
      {
        name: "account_type",
        label: "Tipo de conta",
        options: [
          { value: "CHECKING", label: "Conta corrente" },
          { value: "SAVINGS", label: "Poupança" },
          { value: "PAYMENT", label: "Conta de pagamento" },
        ],
      },
      {
        name: "account_number_masked",
        label: "Conta mascarada",
        placeholder: "Preenchida automaticamente",
        readOnly: true,
      },
      {
        name: "currency",
        label: "Moeda",
        defaultValue: "BRL",
        options: currencies,
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
      description,
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
    fields: [code, name, description],
    columns: [{ name: "code", label: "Código" }],
  },
  "cost-centers": {
    label: "Centro de Custos",
    singular: "centro de custos",
    titleField: "name",
    fields: [
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
    label: "Clientes e Fornecedores",
    singular: "cliente ou fornecedor",
    titleField: "display_name",
    fields: [
      {
        name: "person_type",
        label: "Tipo de pessoa",
        defaultValue: "COMPANY",
        options: [
          { value: "COMPANY", label: "Pessoa Jurídica" },
          { value: "INDIVIDUAL", label: "Pessoa Física" },
        ],
      },
      { name: "legal_name", label: "Razão social" },
      { name: "trade_name", label: "Nome fantasia" },
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
