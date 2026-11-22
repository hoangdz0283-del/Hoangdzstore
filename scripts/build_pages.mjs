import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv[2] || "dist";
const outputDirectory = resolve(projectRoot, outputArgument);
const expectedEntries = new Set(["index.html", "assets", "css", "js", "data"]);
const forbiddenOutputRoots = ["assets", "backend", "css", "data", "js"];
const sourceEntries = ["index.html", "assets", "css", "js", "data"];

function isWithin(parent, candidate) {
    const pathFromParent = relative(parent, candidate);
    return pathFromParent === "" || (
        pathFromParent !== ".." &&
        !pathFromParent.startsWith(`..${sep}`) &&
        !isAbsolute(pathFromParent)
    );
}

if (outputDirectory === projectRoot || isWithin(outputDirectory, projectRoot) ||
    forbiddenOutputRoots.some(name => isWithin(resolve(projectRoot, name), outputDirectory))) {
    throw new Error("Pages output must be a separate folder such as dist/, never a source folder.");
}

if (existsSync(outputDirectory)) {
    const unexpectedEntries = readdirSync(outputDirectory)
        .filter(name => !expectedEntries.has(name));
    if (unexpectedEntries.length) {
        throw new Error(
            `Pages output contains unexpected entries: ${unexpectedEntries.join(", ")}. ` +
            "Choose a clean output folder so private files cannot be published."
        );
    }
}

for (const entry of sourceEntries) {
    const sourcePath = resolve(projectRoot, entry);
    if (!existsSync(sourcePath)) {
        throw new Error(`Required Pages source is missing: ${sourcePath}`);
    }
}

mkdirSync(outputDirectory, { recursive: true });
for (const entry of sourceEntries) {
    cpSync(resolve(projectRoot, entry), resolve(outputDirectory, entry), {
        recursive: true,
        force: true,
    });
}

function assertNoEnvironmentFiles(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = resolve(directory, entry.name);
        if (/^\.env(?:\.|$)/i.test(entry.name)) {
            throw new Error(`Environment files must not be published: ${entryPath}`);
        }
        if (entry.isDirectory()) assertNoEnvironmentFiles(entryPath);
    }
}

assertNoEnvironmentFiles(outputDirectory);

const catalogPath = resolve(outputDirectory, "data", "products.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
if (!Array.isArray(catalog)) {
    throw new Error("data/products.json must contain an array.");
}
const publicProductFields = new Set([
    "id",
    "name",
    "brand",
    "category",
    "description",
    "price",
    "sale_price",
    "image",
    "badge",
    "stock",
    "specifications",
    "is_active",
]);

function assertLocalFile(root, value, description) {
    if (typeof value !== "string" || !value.trim() ||
        /^[a-z][a-z\d+.-]*:/i.test(value) ||
        value.startsWith("/") || value.includes("\\") ||
        value.split("/").includes("..")) {
        throw new Error(`${description} is not a safe site-relative path.`);
    }
    const filePath = resolve(root, value);
    let currentDirectory = root;
    let exactCaseExists = true;
    for (const component of value.split("/")) {
        if (!readdirSync(currentDirectory).includes(component)) {
            exactCaseExists = false;
            break;
        }
        currentDirectory = resolve(currentDirectory, component);
    }
    if (!isWithin(root, filePath) || !existsSync(filePath) ||
        !statSync(filePath).isFile() || !exactCaseExists) {
        throw new Error(`${description} does not exist in Pages output: ${value}`);
    }
}

const productIds = new Set();
for (const product of catalog) {
    if (!product || !Number.isSafeInteger(product.id) || productIds.has(product.id)) {
        throw new Error("Product catalog contains an invalid or duplicate ID.");
    }
    if (Object.keys(product).some(field => !publicProductFields.has(field)) ||
        [...publicProductFields].some(field => !(field in product))) {
        throw new Error(`Product #${product.id} contains an invalid public data schema.`);
    }
    productIds.add(product.id);
    assertLocalFile(outputDirectory, product.image, `Product #${product.id} image`);
}

const manifestPath = resolve(outputDirectory, "assets", "images", "manifest.js");
const manifestSource = readFileSync(manifestPath, "utf8");
const manifestPrefix = "window.HOANGDZ_IMAGE_MANIFEST =";
if (!manifestSource.startsWith(manifestPrefix)) {
    throw new Error("Image manifest has an unexpected format.");
}
const manifestText = manifestSource.slice(manifestPrefix.length).trim().replace(/;$/, "");
const manifest = JSON.parse(manifestText);
for (const [brand, record] of Object.entries(manifest.brands || {})) {
    assertLocalFile(outputDirectory, record.path, `${brand} logo`);
}
for (const [productId, record] of Object.entries(manifest.products || {})) {
    assertLocalFile(outputDirectory, record.imagePath, `Product #${productId} image`);
    assertLocalFile(outputDirectory, record.fallbackPath, `Product #${productId} fallback`);
}
assertLocalFile(outputDirectory, manifest.defaultFallbackPath, "Default image fallback");
if (manifest.hero?.path) {
    assertLocalFile(outputDirectory, manifest.hero.path, "Manifest hero image");
}

if (existsSync(resolve(outputDirectory, "backend"))) {
    throw new Error("Backend files must not be included in the public Pages output.");
}

console.log(`Built Pages site: ${outputDirectory} (${catalog.length} products, local image paths verified).`);
