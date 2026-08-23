# Prompt d’implémentation — moteur TypeScript LibBusinessID

## Mission

Implémente intégralement le dépôt TypeScript de LibBusinessID. Lis entièrement
`engine.md` avant de coder. Exige et lis aussi `rules.proto`, `conformance.proto`,
`ir.md`, `features.md`, le manifeste, `SHA256SUMS`, l’attestation et les deux BINPB
de la même release. Si un élément manque ou se contredit, arrête-toi et fais corriger
`spec` ; ne déduis jamais une sémantique du code Go de référence. Le moteur doit être
idiomatique TypeScript moderne, ESM-first, sans dépendance aux APIs Node dans le
cœur, utilisable dans navigateur, Node et bundlers modernes.

Ne porte pas naïvement une architecture Go/Swift/Kotlin. Préserve la sémantique
commune tout en offrant des types TypeScript naturels et sûrs.

## Environnement et package

- package npm proposé : `@libbusinessid/businessid`, sauf nom déjà réservé par le
  dépôt ;
- ESM-first ; CommonJS uniquement si testé et justifié ;
- TypeScript strict ;
- cible ES2020 ou plus récente documentée ;
- aucune API `fs`, `Buffer`, `process` ou DOM dans le cœur ;
- `@bufbuild/protobuf` / Protobuf-ES pour décoder l’IR **dans le générateur** ; le paquet publié ne décode rien ;
- package tree-shakeable avec `sideEffects: false` si exact ;
- exports explicites et types inclus ;
- bundle officiel disponible synchroniquement sans fetch réseau.

Comme l’import binaire universel varie selon les bundlers, la release peut générer un
module interne exportant un `Uint8Array` à partir de `businessid-rules.binpb`. Ce
module est généré, vérifié contre SHA-256 et non édité manuellement. Ne pas utiliser
Base64 comme format canonique.

Structure recommandée :

```text
.
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── src/
│   ├── index.ts
│   ├── api/
│   ├── domain/
│   ├── runtime/
│   ├── registry/
│   ├── generated/
│   └── assets/rules.generated.ts
├── proto/
├── test/
│   ├── unit/
│   ├── conformance/
│   ├── security/
│   └── assets/conformance.generated.ts
├── scripts/
└── rules.lock
```

## Configuration TypeScript stricte

Activer au minimum :

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "useUnknownInCatchVariables": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "noPropertyAccessFromIndexSignature": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true
}
```

Pas de `any` explicite dans le cœur. Les assertions de type et non-null assertions
sont interdites sauf frontière validée, locale et commentée. Préférer `unknown`,
type guards et unions discriminées.

## API TypeScript attendue

Concevoir une API proche de :

```ts
export type IdentifierInput = Readonly<{
  kind: IdentifierKind;
  value: string;
  countryCode?: string;
}>;

export class BusinessIdEngine {
  static readonly default: BusinessIdEngine;

  canonicalize(input: IdentifierInput, options?: ValidationOptions): CanonicalizationResult;
  validate(input: IdentifierInput, options?: ValidationOptions): ValidationReport;
  validateFormat(input: IdentifierInput, options?: ValidationOptions): ValidationReport;
  validateChecksum(input: IdentifierInput, options?: ValidationOptions): ValidationReport;
}
```

Principes :

- objets publics `Readonly` ;
- unions littérales ou enums chaîne conformes à `engine.md` ;
- `IdentifierKind` accepte toute chaîne avec constantes/types d’aide pour les kinds
  connus ; il ne doit pas être une union fermée ;
- unions discriminées pour erreurs techniques si approprié ;
- entrée invalide retourne un rapport, ne throw pas ;
- construction avec bundle invalide throw une erreur typée ;
- aucun type Protobuf dans les exports ;
- aucune mutation des objets fournis par l’appelant ;
- pas de `isValid` ambigu ;
- sortie JSON naturelle conforme au contrat commun ;
- `.d.ts` propres et API Extractor ou équivalent pour contrôler la surface publique.

Le moteur par défaut est construit une fois depuis le code généré. Aucun top-level
await, fetch ou lecture filesystem nécessaire au chemin par défaut.

Il n’y a pas de fabrique acceptant un bundle en octets à l’exécution. Une version
antérieure de ce document déclarait `static fromRules(bytes: Uint8Array)`, ce qui
imposait de porter le validateur complet et la machine d’exécution de l’IR chez chaque
appelant — c’est-à-dire un interpréteur, que `engine.md` section 1.2 interdit. Un jeu
de règles personnalisé passe par le générateur, à la construction.

### Registre : rien à livrer en V1

Ce moteur n'expose aucun type de registre. `engine.md` section 10 diffère la
consultation d'un registre distant à une version ultérieure, et un moteur qui n'en
porte pas est pleinement conforme.

Trois choses à ne pas faire, parce qu'elles fermeraient la porte :

- n'exposez aucun type de registre, même marqué expérimental : un type public est un
  engagement que SemVer fige ;
- ne rendez aucune méthode de validation asynchrone « au cas où » — la validation
  locale reste synchrone définitivement ;
- ne mettez aucune dépendance HTTP dans le paquet du cœur.

Une consultation de registre porte un jeton d'API : elle ne devra jamais être possible
depuis un navigateur, et vivra donc dans un module séparé, chargé côté serveur
uniquement.


## Protobuf-ES et génération

- Générer les descripteurs/types sous `src/generated`, non réexportés.
- Verrouiller Buf/protoc-gen-es et fournir `generate`/`check:generated`.
- Décoder vers une représentation interne validée, ne pas exécuter directement des
  objets Protobuf mutables.
- Vérifier toutes les valeurs `number`/`bigint`, indices et oneof.
- Ne pas considérer les unknown fields comme sûrs.
- Générer `rules.generated.ts` depuis les octets exacts de `.binpb` avec un script
  déterministe ; vérifier le SHA-256 au build, pas au runtime navigateur si cela
  impose une API crypto.
- Le script peut utiliser Node ; le runtime public ne le peut pas.

## Chaînes et nombres

JavaScript indexe les strings en unités UTF-16. Créer une abstraction interne qui
respecte les points de code et la table whitespace de `engine.md`. Ne jamais utiliser
naïvement `str.length` ou `str[i]` avant d’avoir établi la nature ASCII.

Utiliser `Number` uniquement lorsque la borne prouve l’exactitude entière. Utiliser
`bigint` ou modulo chiffre par chiffre quand nécessaire. Toute conversion est
testée aux bornes. Aucun comportement dépendant de locale (`toLocaleUpperCase`).

## Style, lint et documentation

- ESLint flat config avec typescript-eslint strict et type-aware ;
- Prettier, ou Biome si choisi comme solution unique et justifiée ;
- zéro warning ;
- TSDoc sur toutes les APIs publiques ;
- imports explicites, pas de cycle ;
- complexité limitée ;
- aucun code mort ;
- analyse de taille du bundle ;
- dépendances minimales et audit npm ;
- lockfile commité et gestionnaire (`pnpm`, npm ou yarn) fixé avec Corepack si utile.

Toute règle désactivée doit l’être localement avec justification.

## Tests obligatoires

Utiliser Vitest ou runner moderne équivalent. Couvrir :

- toutes les opérations IR ;
- bundles malformés et limites ;
- conformité BINPB complète ;

Le runner de conformité vient de `spec`, jamais de ce dépôt. Il s'exécute épinglé au
commit que `rules.lock` enregistre sous `source_commit` :

```bash
go run github.com/libbusinessid/spec/cmd/conformance-runner@<source_commit> \
  -corpus spec/businessid-conformance.binpb -- node dist/testee.js
```

N'écris pas de comparateur : un moteur qui juge lui-même ses propres résultats peut
se déclarer conforme en comparant trop faiblement. Ce que tu écris, c'est le testee,
et les tests qui prouvent qu'il ne triche pas.

`invalid_encoding` ne peut pas être un cas de conformité — `ir.md` section 5 étape 1
dit pourquoi. Épingle-le par un test natif portant une chaîne contenant une demi-paire
de substitution non appariée, que le type `string` de JavaScript admet.

- API et type-level tests (`tsd` ou équivalent) ;
- Unicode, UTF-16, surrogate pairs et ASCII ;
- déterminisme et absence de mutation ;
- exécution sous Node et navigateur headless réel ;
- bundling avec au moins Vite/Rollup ou esbuild ;
- import ESM dans un projet consommateur minimal ;
- exports et tree shaking.

Property testing avec `fast-check`. Fuzzing du décodeur et runtime à partir de bytes
mutés ; utiliser un harness Node en CI planifiée. Benchmarks avec un outil stable ou
`node:perf_hooks` uniquement dans les scripts de benchmark, jamais dans le cœur.

Quality gates :

- lignes/statements/functions ≥ 95 % ;
- branches ≥ 90 % ;
- 100 % dispatch IR et refus version/feature ;
- TypeScript compile sans emit et sans erreur ;
- tests sur version Node minimale et actuelle ;
- tests navigateur ;
- mutation testing avec Stryker, score cœur recommandé ≥ 80 % ;
- code généré excluable de couverture, jamais runtime/validation.

## CI et publication npm

GitHub Actions :

- install frozen lockfile ;
- lint + format check ;
- `tsc --noEmit` ;
- tests unitaires + conformité ;
- couverture et seuils ;
- property/fuzz smoke ;
- Stryker planifié ;
- `check:generated` ;
- audit dépendances ;
- build ESM et analyse package ;
- test Node minimal/actuel ;
- test navigateur headless ;
- `npm pack` puis installation du tarball dans un projet vierge ;
- vérification des exports, types et absence de fichiers manquants ;
- provenance npm et publication protégée sur tag.

## Documentation

README : installation, ESM, exemple, format/checksum, unsupported, moteur custom,
versions, environnements supportés, registre futur et limites. Générer TypeDoc si
utile. Ajouter SECURITY, CONTRIBUTING, changelog et politique SemVer.

## Interdictions spécifiques

- pas de Node built-ins dans `src` runtime ;
- pas de fetch/top-level await pour le moteur par défaut ;
- pas de `any`, non-null assertion ou cast non vérifié dans le cœur ;
- pas de regex métier ;
- pas de locale ;
- pas d’objets Protobuf exportés ;
- pas de CommonJS annoncé sans tests ;
- pas de cas de conformité ignoré ;
- pas de copie naïve d’un autre langage.

## Livrables et définition de terminé

Livrer package npm complet, runtime, API, code émis, générateur, tests, fast-check, fuzz harness, benchmarks, CI, docs et publication. Tous les
critères `engine.md`, TypeScript strict, lint, conformité, couverture, navigateur,
`npm pack` et test consommateur doivent être verts, sans TODO V1 ni warning.
