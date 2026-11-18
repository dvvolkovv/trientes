/**
 * Значения формы паспорта. Отдельным модулем, а не в самой форме: форма — клиентский
 * компонент, а пустые значения нужны серверной странице, и вызов функции из клиентского
 * модуля на сервере падает («it can only be rendered as a Component») — поймано живым
 * прогоном.
 */
export type ProductFormValues = {
  id?: string;
  name: string;
  brand: string;
  manufacturerName: string;
  category: string;
  language: string;
  gtin: string;
  description: string;
  usage: string;
  ingredients: string;
  attributes: { key: string; value: string; unit?: string }[];
  photos: { url: string; label?: string }[];
  videoUrl: string | null;
  documents: { kind: string; url: string; label?: string }[];
};

export function emptyProduct(language: string): ProductFormValues {
  return {
    name: "",
    brand: "",
    manufacturerName: "",
    category: "other",
    language,
    gtin: "",
    description: "",
    usage: "",
    ingredients: "",
    attributes: [],
    photos: [],
    videoUrl: null,
    documents: [],
  };
}
