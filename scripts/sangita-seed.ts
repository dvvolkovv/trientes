/**
 * Заведение карточки живого предприятия Sangita Yoga Studio (Вена) по просьбе
 * владельца 28 ноября.
 *
 *   npx tsx scripts/sangita-seed.ts            # посев
 *   npx tsx scripts/sangita-seed.ts --dump     # что уже заведено
 *
 * Данные взяты **с их собственного сайта** (`sangita.com`, страница Impressum и
 * главная) и ниоткуда больше: юридическое лицо, налоговый номер, адрес, телефоны,
 * почта, описание, перечень занятий, прейскурант, фотографии и логотип. Чего на
 * сайте нет — часов работы, принимаемых монет, способов оплаты, политики возврата —
 * того здесь нет тоже: выдуманное поле на витрине это обещание покупателю, которого
 * продавец не давал.
 *
 * Предприятие и точка заводятся в `PENDING` и идут обычным путём очереди, как любая
 * чужая заявка: решение принимает человек. Владелец карточки — учётная запись
 * владельца платформы (`biotecbank`), и поэтому дело должен решать **другой**
 * владелец (`dmitryvolkov`): членство в предприятии — конфликт интересов (слайс AS).
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { ensureCase } from "../src/lib/cases/ensure";
import { logCompanyAction } from "../src/lib/company-team/journal";
import { companyLogoRoot, companyLogoUrl } from "../src/lib/company-logo";
import { slugify } from "../src/lib/slugify";

/** Запись владельца платформы, с которой карточка видна в кабинете. */
const OWNER_USER_ID = "cmpjvl5q000036s3yc6cdc54e"; // biotecbank@me.com

const SITE = "https://sangita.com";

const LOGO = `${SITE}/wp-content/uploads/2025/06/2logo-2.png`;
const PHOTOS = [
  { url: `${SITE}/wp-content/uploads/2025/06/DSC_1565-1-scaled-1.jpg`, label: "Studio hall" },
  { url: `${SITE}/wp-content/uploads/2025/06/DSC_1440-scaled-1.jpg`, label: "Aerial yoga in hammocks" },
  { url: `${SITE}/wp-content/uploads/2025/06/DSC_1691-1-scaled-1.jpg`, label: "Practice" },
  { url: `${SITE}/wp-content/uploads/2025/06/DSC_2602-scaled-1.jpg`, label: "Sound healing" },
  { url: `${SITE}/wp-content/uploads/2025/06/DSC_1357-1-scaled-1.jpg`, label: "Studio" },
];

const DESCRIPTION = [
  "Sangita Yoga Studio is a boutique wellness space in central Vienna, offering yoga, meditation",
  "and healing practices in English, Russian and German. We create a serene environment where",
  "everyone can explore movement, sound and stillness on their path to balance and well-being.",
  "",
  "Classes: Yoga & Meditation for beginners, Hatha Yoga, Kundalini Yoga, Aerial Yoga in hammocks,",
  "Pilates & Mobility with myofascial release, Yoga & Sound Healing with singing bowls, Myofascial",
  "Release Practice, Yoga Nidra and Yoga Stretching. Private sessions and mini-groups are available",
  "on request, and the studio can be rented for workshops and events.",
].join(" ").replace(/  +/g, " ");

type Service = {
  name: string;
  description: string;
  price: string;
  unit: "service" | "hour";
  saleRules: string | null;
  bookUrl: string;
  photo: number;
};

/** Прейскурант с их страницы «Our Prices» — слово в слово, без наших округлений. */
const SERVICES: Service[] = [
  {
    name: "Intro Class",
    description:
      "First-time visitors only: experience any group class of your choice at Sangita Yoga Studio in Vienna — yoga, aerial yoga, pilates, sound healing or meditation.",
    price: "20",
    unit: "service",
    saleRules: "First-time visitors only. One class of your choice.",
    bookUrl: "https://www.eversports.at/sw/sangita-yoga-studio",
    photo: 0,
  },
  {
    name: "Single Class",
    description:
      "Flexible attendance: join any group class at Sangita Yoga Studio at your convenience — in studio in central Vienna or online.",
    price: "25",
    unit: "service",
    saleRules: "Any single group class, in studio or online.",
    bookUrl: "https://www.eversports.at/sw/sangita-yoga-studio",
    photo: 1,
  },
  {
    name: "3-Class Pass",
    description:
      "For a focused boost: attend any 3 group classes at Sangita Yoga Studio within 1 month.",
    price: "55",
    unit: "service",
    saleRules: "3 group classes, valid 1 month.",
    bookUrl: "https://www.eversports.at/sw/sangita-yoga-studio",
    photo: 2,
  },
  {
    name: "5-Class Pass",
    description:
      "For steady progress: attend any 5 group classes at Sangita Yoga Studio within 3 months.",
    price: "110",
    unit: "service",
    saleRules: "5 group classes, valid 3 months.",
    bookUrl: "https://www.eversports.at/sw/sangita-yoga-studio",
    photo: 0,
  },
  {
    name: "10-Class Pass",
    description:
      "For deeper consistency: attend any 10 group classes at Sangita Yoga Studio within 6 months.",
    price: "220",
    unit: "service",
    saleRules: "10 group classes, valid 6 months.",
    bookUrl: "https://www.eversports.at/sw/sangita-yoga-studio",
    photo: 1,
  },
  {
    name: "Unlimited Annual Membership",
    description:
      "Unlimited practice all year: all group classes at Sangita Yoga Studio — yoga, sound, movement and meditation — with unlimited access.",
    price: "90",
    unit: "service",
    saleRules: "90 EUR per month, all group classes, valid for 12 months.",
    bookUrl: "https://www.eversports.at/mt/sangita-yoga-studio/50827",
    photo: 2,
  },
  {
    name: "Studio Rental",
    description:
      "Rent the Sangita studio in the heart of Vienna for workshops, private sessions or special events — a peaceful, light-filled space with yoga equipment and aerial hammocks.",
    price: "50",
    unit: "hour",
    saleRules: "From 50 EUR per hour; the final price depends on the time and the room setup.",
    bookUrl: `${SITE}/rent-studio/`,
    photo: 3,
  },
];

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "trientes.org/1.0 (merchant card import)" },
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function extOf(bytes: Buffer): "png" | "jpg" | "webp" {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  return "webp";
}

async function store(root: string, companyId: string, bytes: Buffer, nameBytes: number): Promise<string> {
  const dir = join(root, companyId);
  await mkdir(dir, { recursive: true });
  const name = `${randomBytes(nameBytes).toString("hex")}.${extOf(bytes)}`;
  await writeFile(join(dir, name), bytes);
  return name;
}

async function dump() {
  const company = await prisma.company.findFirst({
    where: { legalName: "Sangita GesbR" },
    include: {
      points: { select: { id: true, name: true, status: true, lat: true, lon: true } },
      productOffers: { select: { price: true, currency: true, unit: true, product: { select: { name: true, slug: true } } } },
      documents: { select: { kind: true, kindCustom: true, title: true, linkUrl: true, publishedAt: true } },
      ads: { select: { id: true, title: true, status: true, slides: true } },
    },
  });
  if (!company) {
    console.log("карточки нет");
    return;
  }
  console.log(
    JSON.stringify(
      {
        id: company.id,
        status: company.status,
        displayName: company.displayName,
        legalName: company.legalName,
        taxNumber: company.taxNumber,
        category: company.category,
        industry: company.industry,
        timezone: company.timezone,
        logoUrl: company.logoUrl,
        address: company.address,
        phone: company.phone,
        email: company.email,
        website: company.website,
        points: company.points,
        offers: company.productOffers.map((o) => `${o.product.name} — ${o.price} ${o.currency}/${o.unit} (/${o.product.slug})`),
        documents: company.documents,
        ads: company.ads.map((a) => ({ id: a.id, title: a.title, status: a.status, slides: (a.slides as unknown[] | null)?.length ?? 0 })),
      },
      null,
      2,
    ),
  );
}

async function main() {
  if (process.argv.includes("--dump")) {
    await dump();
    return;
  }

  const existing = await prisma.company.findFirst({ where: { legalName: "Sangita GesbR" }, select: { id: true } });
  if (existing) {
    console.log(`уже заведено: ${existing.id} (повторный посев не делаем)`);
    return;
  }

  const company = await prisma.company.create({
    data: {
      ownerUserId: OWNER_USER_ID,
      legalName: "Sangita GesbR",
      displayName: "Sangita Yoga Studio",
      // Номера в торговом реестре у GesbR нет (такое товарищество в Firmenbuch не
      // вносят), поэтому поле пустое, а не заполнено похожим числом.
      taxNumber: "ATU80768108",
      description: DESCRIPTION,
      category: "wellness",
      industry: "health",
      timezone: "Europe/Vienna",
      country: "Austria",
      countryCode: "AT",
      city: "Vienna",
      street: "Fleischmarkt",
      houseNumber: "16/25a",
      postalCode: "1010",
      address: "Fleischmarkt 16/25a, 1010 Vienna, Austria",
      phone: "+43 676 5734954",
      email: "info@sangita.com",
      website: SITE,
      socials: [{ network: "instagram", url: "https://www.instagram.com/sangita_yoga_studio" }],
      members: { create: { userId: OWNER_USER_ID, role: "OWNER" } },
    },
    select: { id: true, displayName: true },
  });
  console.log(`company ${company.id}`);

  // --- логотип -------------------------------------------------------------------
  const logoBytes = await fetchBytes(LOGO);
  const logoName = await store(companyLogoRoot(), company.id, logoBytes, 12);
  await prisma.company.update({
    where: { id: company.id },
    data: { logoUrl: companyLogoUrl(company.id, logoName), logoShape: "rounded", logoFit: "contain" },
  });
  console.log(`logo ${companyLogoUrl(company.id, logoName)} (${logoBytes.length} B)`);

  // --- фотографии точки ----------------------------------------------------------
  const pointRoot = process.env.POINT_PHOTOS_ROOT ?? join(process.cwd(), "public", "uploads", "points");
  const pointPhotos: { url: string; label: string | null }[] = [];
  for (const photo of PHOTOS) {
    const bytes = await fetchBytes(photo.url);
    const name = await store(pointRoot, company.id, bytes, 12);
    pointPhotos.push({ url: `/uploads/points/${company.id}/${name}`, label: photo.label });
  }
  console.log(`point photos ${pointPhotos.length}`);

  // --- точка ---------------------------------------------------------------------
  // Часов работы на сайте нет (расписание занятий живёт в чужой службе Eversports, за
  // Cloudflare), поэтому `hours` пусто: неверное «закрыто» отправит человека мимо
  // открытой двери. Пояс при этом заполнен — без него состояние не считается вовсе.
  const point = await prisma.companyPoint.create({
    data: {
      companyId: company.id,
      type: "SHOP",
      name: "Sangita Yoga Studio",
      description:
        "Boutique yoga, pilates and aerial studio in Vienna's 1st district — Fleischmarkt 16, staircase 1, top 25a. Classes in English, German and Russian.",
      lat: 48.2105932,
      lon: 16.3768773,
      countryCode: "AT",
      city: "Vienna",
      street: "Fleischmarkt",
      houseNumber: "16/25a",
      postalCode: "1010",
      address: "Fleischmarkt 16/25a, 1010 Vienna, Austria",
      timezone: "Europe/Vienna",
      category: "wellness",
      phone: "+43 676 5734954",
      website: SITE,
      photos: pointPhotos,
      logoUrl: companyLogoUrl(company.id, logoName),
      socials: [{ network: "instagram", url: "https://www.instagram.com/sangita_yoga_studio" }],
    },
    select: { id: true },
  });
  console.log(`point ${point.id}`);

  // --- паспорта услуг и предложения ---------------------------------------------
  const productRoot = process.env.PRODUCT_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "products");
  const productPhotoUrls: string[] = [];
  for (const photo of PHOTOS.slice(0, 4)) {
    const bytes = await fetchBytes(photo.url);
    const name = await store(productRoot, company.id, bytes, 12);
    productPhotoUrls.push(`/uploads/products/${company.id}/${name}`);
  }

  for (const service of SERVICES) {
    const base = slugify(`sangita ${service.name}`, "product");
    const product = await prisma.product.create({
      data: {
        slug: base,
        createdByCompanyId: company.id,
        name: service.name,
        brand: "Sangita Yoga Studio",
        category: "services",
        language: "en",
        description: service.description,
        photos: [{ url: productPhotoUrls[service.photo] ?? productPhotoUrls[0] }],
      },
      select: { id: true, slug: true },
    });
    await prisma.productEdit.create({
      data: {
        productId: product.id,
        companyId: company.id,
        userId: OWNER_USER_ID,
        field: "created",
        after: { name: service.name },
      },
    });
    await prisma.productOffer.create({
      data: {
        companyId: company.id,
        productId: product.id,
        price: service.price,
        currency: "EUR",
        unit: service.unit,
        saleRules: service.saleRules,
        onlineUrl: service.bookUrl,
      },
    });
    console.log(`offer ${service.price} EUR/${service.unit} → /${product.slug}`);
  }

  // --- публичные бумаги ----------------------------------------------------------
  await prisma.companyDocument.createMany({
    data: [
      {
        companyId: company.id,
        kind: "other",
        kindCustom: "Impressum",
        title: "Impressum (Sangita GesbR)",
        linkUrl: `${SITE}/impressum`,
        publishedAt: new Date(),
        sortOrder: 0,
        uploadedById: OWNER_USER_ID,
      },
      {
        companyId: company.id,
        kind: "privacy",
        title: "Privacy Policy",
        linkUrl: `${SITE}/privacy-policy`,
        publishedAt: new Date(),
        sortOrder: 1,
        uploadedById: OWNER_USER_ID,
      },
    ],
  });
  console.log("documents 2");

  // --- баннер карточки: черновик, публикует модератор (слайс CC) -----------------
  const adRoot = process.env.AD_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "ads");
  const slides: { kind: "IMAGE"; url: string; posterUrl: null }[] = [];
  for (const photo of PHOTOS.slice(0, 3)) {
    const bytes = await fetchBytes(photo.url);
    const name = await store(adRoot, company.id, bytes, 16);
    slides.push({ kind: "IMAGE", url: `/uploads/ads/${company.id}/${name}`, posterUrl: null });
  }
  const intro = await prisma.product.findFirst({
    where: { createdByCompanyId: company.id, name: "Intro Class" },
    select: { id: true },
  });
  const ad = await prisma.companyAd.create({
    data: {
      companyId: company.id,
      kind: "PROMO",
      title: "The path to harmony",
      body:
        "Yoga, meditation and sound healing in the heart of Vienna, in English, German and Russian. " +
        "First-time visitors can try any group class for 20 EUR.",
      language: "en",
      mediaKind: "IMAGE",
      mediaUrl: slides[0].url,
      slides,
      action: intro ? "PRODUCT" : "NONE",
      productId: intro?.id ?? null,
      pointId: point.id,
      status: "DRAFT",
      createdById: OWNER_USER_ID,
    },
    select: { id: true },
  });
  console.log(`ad ${ad.id} (DRAFT, ${slides.length} кадра)`);

  // --- дела очередей -------------------------------------------------------------
  await ensureCase({
    subjectType: "COMPANY",
    subjectId: company.id,
    title: company.displayName,
    applicantUserId: OWNER_USER_ID,
  });
  await ensureCase({
    subjectType: "POINT",
    subjectId: point.id,
    title: `${company.displayName} — Fleischmarkt 16`,
    applicantUserId: OWNER_USER_ID,
  });
  console.log("cases: COMPANY + POINT");

  await logCompanyAction({
    companyId: company.id,
    actorUserId: OWNER_USER_ID,
    action: "PROFILE_SAVED",
    subject: company.displayName,
    meta: { source: "sangita.com", by: "scripts/sangita-seed.ts" },
  });

  console.log(`\nготово: /ru/cabinet/companies/${company.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
