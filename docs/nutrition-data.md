# 食刻营养数据与计算教学

食刻区分可追溯营养参考和 AI 粗估。优先使用基础食物库和参考配方；库没有的食物可以采用模型提供的每 100 g 三档粗估范围，用户确认保存后进入单设备「个人估算库」。默认普通档，以所选范围中值记账；确定营养数值可以手动覆盖。所有 AI 来源持续显示「AI 粗估，非实测」，不会把估算值写入 USDA 数据。模型还会生成名称、可食重量估计、可见配料、不确定提示和营养假设；无法合理估计的营养字段保存为 `null`。

## 1. 数据来源和许可

内置 **5,675 条 USDA 食物参考**（472 条 SR Legacy + 5,203 条 FNDDS），另有 60 个应用参考配方。条目数包含同一食物的多种配方、加工与做法，不能解释为 5,675 种独立中国菜。运行时直接读取随应用发布的数据，不需要营养 API Key 或联网查询。

### SR Legacy 基础食物

**472 条 SR Legacy 基础食物**实际从官方 **2018 年 4 月 CSV ZIP** 下载并提取，包含熟食、早餐面点、饮品、奶类和零食。SR Legacy 是冻结的历史参考数据；它适合离线原型，并不意味着代表当下每种中国食材或每个品牌。

- 官方下载页：[FoodData Central Download Datasets](https://fdc.nal.usda.gov/download-datasets/)。
- 原始压缩包：[FoodData_Central_sr_legacy_food_csv_2018-04.zip](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip)。
- 许可：[USDA API Guide 的 Licensing](https://fdc.nal.usda.gov/api-guide/#bkmk-9)。USDA 声明数据为公共领域，按 CC0 1.0 发布，可以使用；食刻保留 USDA 来源标注。
- 推荐来源引用：U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.

选择清单在 `packages/shared/data/usda-selection.json`，生成数据在 `packages/shared/src/usda-foods.generated.ts`。每条保留 `fdcId`、原始英文描述、数据集名称、`2018-04` 版本、原始 `publicationDate`、官方详情地址、下载地址、生熟状态及中文别名。发布日与数据集版本不是同一个概念，所以两者同时保存。

这次提取的校验值：

```text
ZIP SHA-256:
b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0
food.csv SHA-256:
de8b0390058db4f102368c9fbdfde144790b480ff4cb0507c0e060ef99805dee
food_nutrient.csv SHA-256:
6d07e6fc062b09750c4d95112be5a5cdb56a2346efcfd0c96b7a7d705812d4bd
```

营养值原样来自 `food_nutrient.csv` 的 `amount`，不是 AI 补齐的数值。只取以下 USDA 营养 ID：`1008` 为 Energy / KCAL，`1003` 为 Protein / G，`1004` 为 Total lipid (fat) / G，`1005` 为 Carbohydrate, by difference / G。`1062` 对应 kJ，不能当 kcal 使用。基础食物值以 **每 100 g 可食部分**为口径。

### FNDDS 膳食调查参考

新增 **5,203 条 FNDDS 2021–2023** 参考来自 USDA 官方 2024-10-31 JSON 发布包。FNDDS 为美国饮食调查提供按食用状态整理的食物、饮品及份量资料；包含包子、春卷、蒸饺、寿司、面食、汤粥，以及大量不同配料、糖油和品牌版本。它是美国膳食参考，不能把同名条目直接视为中国本地做法的精确值。

- 官方说明：[FoodData Central Data Documentation](https://fdc.nal.usda.gov/data-documentation/)。
- 原始 ZIP：[FoodData_Central_survey_food_json_2024-10-31.zip](https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip)。同样遵循前述 USDA 公共领域／CC0 许可。
- 原文件包含 5,432 条，排除 229 条婴幼儿专用、母乳及调查未分类条目。营养棒、蛋白粉与营养饮品保留原品牌和粉状／冲调限定；不据此推荐特定产品。
- `packages/shared/data/fndds-import-manifest.json` 记录来源、原始与导入数量、排除数量、哈希及本地化统计；`fndds-localization.mjs` 只维护名称与检索词；营养写入 `src/fndds-foods.generated.ts`。
- 5,149 条名称包含中文，其中 4,102 条无英文字母；其余包含品牌、专名或尚未翻译的词，54 条名称保留英文。中文索引通过本地词表转换，可能需要继续人工校对；原始英文描述始终可检索和核对。不使用 AI 批量编写营养值。

每条保留 `fdcId`、原始英文描述、`foodCode`、`USDA FNDDS`、`2021-2023`、发布日期与官方链接。营养从 JSON 的 `foodNutrients[].nutrient.id` 及 `amount` 原样提取，使用相同的四个营养 ID，并检查原始单位与合法数值。缺失值保留 `null`。名称／别名与原有基础食物及应用配方冲突时，新增记录保留“膳食参考”限定，避免扩库改变常用精确匹配。新增名称的批量本地化不是 USDA 官方中文译名。

```text
ZIP SHA-256:
dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb
surveyDownload.json SHA-256:
2e7eb9fda92adf1d4d784dba5eaa3a7fd4418cd86ccff383c7c9294d79e9b808
```

## 2. 从官方 CSV 复现数据

日常启动不需要下载原始数据库，也不需要 USDA API Key。只有维护或审计数据时执行本节。

从项目根目录，用 PowerShell 下载、解压，然后运行离线提取脚本：

### SR Legacy CSV

```powershell
New-Item -ItemType Directory -Force .data-cache | Out-Null
Invoke-WebRequest -Uri 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip' -OutFile '.data-cache/usda-sr-legacy-2018.zip'
Expand-Archive -LiteralPath '.data-cache/usda-sr-legacy-2018.zip' -DestinationPath '.data-cache/usda-sr-legacy-2018' -Force
node packages/shared/scripts/extract-usda.mjs
```

如果此环境的 PowerShell TLS 下载失败，可通过浏览器下载同一个官方 ZIP，再解压到上述目录。不要用不明镜像替代来源。提取脚本也可接收已解压目录：

```powershell
node packages/shared/scripts/extract-usda.mjs 'D:/指定目录/FoodData_Central_sr_legacy_food_csv_2018-04'
```

脚本通过 `fdc_id` 关联食物和营养值，正确解析带逗号和引号的 CSV，检查数据是否存在、是否有限且非负，然后生成 TypeScript 数组。缺失字段保留 `null`。中文名称与别名是食刻人工维护的索引，原始英文描述始终保留。添加食物时先确认官方描述及烹饪状态，再更新选择清单并重新提取；不能手改生成文件里的营养数值。

### FNDDS JSON

使用 Node 24 下载官方包（此工作区 PowerShell 的 TLS 下载失败，Node HTTPS 下载已验证成功）：

```powershell
New-Item -ItemType Directory -Force .data-cache | Out-Null
node --input-type=module -e "const r=await fetch('https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip');if(!r.ok)throw new Error('下载失败 '+r.status);const {writeFile}=await import('node:fs/promises');await writeFile('.data-cache/usda-fndds-2021-2023.zip',new Uint8Array(await r.arrayBuffer()));"
Expand-Archive -LiteralPath '.data-cache/usda-fndds-2021-2023.zip' -DestinationPath '.data-cache/usda-fndds-2021-2023' -Force
npm run data:fndds
```

也可指定 JSON：`npm run data:fndds -- 'D:/指定目录/surveyDownload.json'`。脚本依赖 Node 24 的 TypeScript 类型剥离能力，直接读取配方源码以预留名称，不依赖旧构建产物。生成文件采用紧凑行数据，公共来源字段只在物化时赋值；不要把整个原始调查 JSON 打包进前端。原始下载包放在已忽略的 `.data-cache/`，日常启动无需下载。更新词表后重新生成，并运行单元测试、类型检查与构建；`fndds.test.ts` 校验导入清单、数值范围、包子样本原值、中文匹配、旧配方优先级和快照隔离。

本轮另用原始 JSON 逐条核对生成数据，5,203 × 4 = 20,812 个营养字段均一致。产物的单个 JS 约 1.41 MB（gzip 约 308 kB），构建工具会提示超过 500 kB；当前仍可正常构建，三种浏览器场景的搜索和分批浏览均已通过。公网部署时应启用静态资源压缩与带哈希文件的缓存；后续继续扩大数据时可改为独立数据包或离线数据库，不靠调高告警阈值隐藏体积。

## 3. 基础食物如何计算

公式为：`该份营养 = 每 100 g 营养 × 可食重量 g ÷ 100`。

例如 FDC `168878` 是熟制、强化、长粒白米饭。官方数据每 100 g 为 `130 kcal`、`2.69 g` 蛋白质、`0.28 g` 脂肪、`28.17 g` 碳水。150 g 对应约 `195 kcal`。这些小数来自参考数据，照片估重仍有误差，界面必须显示「约／估算」，不能因此声称精确测量。

```ts
import { findFood, createFoodEntry, calculateNutrients } from '@shike/shared'

const rice = findFood('米饭')
if (rice) {
  const entry = createFoodEntry(rice, 150)
  const nutrients = calculateNutrients(entry) // energyKcal 为 195
}
```

`findFood` 只匹配明确中文名称或别名；例如「新鲜蓝莓」与「蓝莓」、「新鲜草莓」与「草莓」是清单中逐条维护的等价别名，「蓝莓酱」仍然未知。不会全局删除「生／熟／新鲜」后强行匹配，也没有把「宫保鸡丁」模糊匹配成「鸡胸肉」的逻辑。USDA 美国产地、品种、烹饪方法和中国实际食物可能不同，所以用户需要确认具体食物和生熟口径。带骨肉、整果、果皮等应使用实际吃下的可食重量。牛奶等在首版也按 g 输入；不能无条件把 mL 等同于 g。

USDA 原味酸奶、强化豆奶、具体肉类部位都只是对应原始描述的参考。商业品牌、含糖饮品、自制豆浆及带酱汁混合菜不能假定与这些数据相同；有包装营养标示时建议改为手动输入。

新增的美式中餐、冷冻烤制点心和罐头汤均在名称保留做法与来源限定。例如“宫保鸡丁（美式中餐参考）”不添加“宫保鸡丁”这个通用别名，避免把对应样本静默当作中国菜的通用数据；普通“宫保鸡丁”仍匹配可编辑的应用参考配方。

食物选择默认隐藏生肉、生蛋、需烹调的蔬菜和需要复水的干米／干面等原料；水果、黄瓜、生菜、坚果等即食项保留。开启“包含生重／干重食材”可查看全部库，已有生重历史条目也仍显示为已选。筛选不删除原始数据，也不改变配方所需的原料与历史快照。

## 4. 参考配方如何计算

现有 **60 个参考配方**，包括番茄炒蛋、蛋炒饭、清炒西兰花、宫保鸡丁等家常菜，并新增汤羹、无糖参考粥、三明治、酸奶水果碗和无糖拿铁等。完整列表在 `packages/shared/src/recipes.ts`。它们是 **人工设定的配比假设 + USDA 基础食物**，不是 USDA 对中国菜的精确测量，也不是模型确认的配方。

每个配方的 `referenceWeightG` 等于基准配料最终可食重量之和。例如清炒西兰花基准为 200 g 熟西兰花 + 8 g 实际摄入油，共 208 g。照片估为 104 g 时，默认把所有配料按 0.5 倍缩放。含独立油配料的配方提供少油／普通／多油情景，默认普通档的油量中值仍等于原配方基准；没有额外油的粥、三明治和饮品不凭空添加油档。熟肉、熟米饭、熟菜使用相应熟制参考数据；沙拉里的蔬菜使用即食生重。番茄炒蛋使用不含额外油的水煮全蛋近似熟蛋，并明确提示这个替代关系，避免选用已经含油的炒蛋数据后再重复加油。

新增汤和粥中的水代表实际吃下／喝下的水。小米粥基准为 100 g 已煮熟小米饭与 200 g 额外水，并不是 100 g 干小米加水；无糖只是这个配方的明确假设，含水量和额外糖可修改。肉汤溶出的脂肪不能按零热量清水直接忽略，因此莲藕排骨汤等保留该限制提示。

```ts
import { findRecipe, createRecipeEntry, calculateNutrients } from '@shike/shared'

const recipe = findRecipe('清炒西兰花')
if (recipe) {
  const entry = createRecipeEntry(recipe, 104)
  // 默认该份是 100 g 西兰花和 4 g 油。
  // 用户确认只吃了 2 g 油时，第三个参数以该份配料的实际 g 覆盖。
  const corrected = createRecipeEntry(recipe, 104, { oil: 2 })
  calculateNutrients(corrected)
}
```

整道菜只保存为一个 `FoodEntry`。内部 `recipeSnapshot.ingredients` 是计算依据，汇总时不作为额外记录再次累计。油本身只列一次；锅里剩余油和汤汁里的油不自动视为吃掉。成品总重保持用户输入的值，配料可以分别修改；修改后若配料重量与成品重量不一致，需要用户重新确认，不自动猜测含水变化。用户直接填写确定配料重量时撤销油档位，第三个参数传入 `ingredientOverrides` 创建的记录也不会再自动附油范围。调味糖、勾芡、沙拉酱等不确定部分以警告提示并允许另行补充。

## 5. 缺失值、历史快照和测试

`null` 表示缺少数据，`0` 表示明确为零。`calculateNutrients` 遇到未确定重量或缺失营养时，保留对应字段为 `null`；明确吃了 0 g 则该份营养为零。`aggregateNutrients` 每个字段返回 `{ known, missing }`，同时返回 `incompleteEntries`。每日总量应显示「已知部分估算」和待补充数量，不能用零覆盖缺失。

保存食物时复制 `nutrientsPer100g`、来源、配方快照和 AI 快照。历史计算只使用已保存快照；后续扩充数据库、修改参考配方或更新个人估算库不会改变以前的日摄入。手动修改营养值后应显示用户输入来源，不再把修改值归因于 USDA。

相关测试在 `packages/shared/tests`：官方记录 ID 和具体数值、重量换算、生熟匹配、配方缩放、油只累计一次、缺失传播、快照稳定性、备份迁移、重复主键／名称、AI 粗估范围和外部模型的结构校验。

```powershell
npx vitest run packages/shared/tests
npm run build -w @shike/shared
```

未来扩充可增加更多可追溯基础食物和用户自定义配方。照片里没法可靠判断的食用油、糖、酱汁与重量仍需用户确认；更换视觉模型不能自动消除这些物理信息缺失。

## 6. AI 粗估与个人估算库

模型返回的 `estimatedNutrientsPer100g` 是 `{ energyKcal, proteinG, fatG, carbsG }` 或 `null`，每个营养字段也可以为 `null`。这些值都是 **每 100 g 可食食物**，不能把整份营养当作每 100 g 再乘重量。`nutritionAssumptions` 保留关于烹饪、油量、糖和含水量的假设。旧识别 JSON 缺少这两个字段时，共享校验默认补 `null` 和 `[]`；新实际模型接口要求两字段，避免遗漏假设。

服务端和前端执行 Zod 结构校验：数值必须有限、非负，每 100 g 能量最多 1000 kcal，蛋白质、脂肪和碳水各最多 100 g。合法范围仅排除明显非法数值，**不证明 AI 估值正确**。模型不知道的字段应留空，不能为了凑总量补零。水、油、酱汁和糖在照片中通常无法可靠定量；流动粥的含水比例、自制豆浆的浓度、饮料是否加糖仅能设定假设。用户可以补充配方、干料重量、成品总重或包装标示，再确认估算。

个人库的 `EstimatedFood` 与 USDA `FoodDefinition` 完全独立，字段为 `id`、`name`、`nutrientsPer100g`、`provenance`、`assumptions`、`provider`、`model`、创建与更新时间，并可保存完整 `estimateProfile` 和选中 `estimateLevel`。只有用户确认保存餐食后才更新本地库；模拟模型来源保留 `provider: 'mock'`，不能变成真实测量来源。以后相同名称可复用个人估算值，用户仍然能够修改；不同配方与含糖、生熟区别应使用不同名称。

```ts
import { findEstimatedFood, createEstimatedFoodEntry } from '@shike/shared'

// estimatedFoods 来自当前浏览器 IndexedDB，不是公共数据库。
const personal = findEstimatedFood('自制小米粥', estimatedFoods)
if (personal) {
  const entry = createEstimatedFoodEntry(personal, 200)
  // entry.kind 为 'ai'，referenceId 指向个人库 ID，aiEstimateSnapshot 保留来源及假设。
}
```

名称用 `normalizeFoodName` 统一空白、括号和大小写后精确匹配，不删除「生」「熟」「糖」「酱」等词；个人库每个规范化名称只保留一条，更新时沿用原 ID 和创建时间。匹配 USDA 与参考配方优先，个人库次之，本次模型粗估最后。没有任何可靠结果时继续保留待补充，不强行输出完整热量。

备份现为 `schemaVersion: 2`，新增 `estimatedFoods`。导入原 v1 备份时自动迁移为 v2 并设置空个人库，旧餐食记录和营养快照保持原样。v2 备份中重复个人库 ID 或规范化名称会被拒绝，避免导入时静默覆盖来源。导出仍不包含照片或密钥。

## 7. 三档范围、中值与确定数覆盖

`NutritionEstimateProfile` 含一个主要因素 `factor`（`sweetness` 糖／甜度、`oil` 油量、`general` 包括粥的稠度等一般假设）和恰好三个 `options`。每项保存 `level`（`low`／`medium`／`high`）、中文 `label`、`rangesPer100g` 和 `assumptions`。每种营养是 `{ min, max }` 或 `null`，按低、中、高显示；没有选择档位时默认 `medium`。这是情景范围，**不是统计置信区间，也不是模型准确率**。

例如用于演示粥稠度的三个范围可以是 40–60、60–90、90–120 kcal，三者均指 **每 100 g**。这些数字只是用户指定的演示情景，不能写成所有粥的食品实测标准。普通档中值为 75 kcal/100 g：吃 200 g 时显示约 120–180 kcal，日记账采用约 150 kcal。低档中值为 50、高档中值为 105；切档同步三大营养素中值及所选假设，不只是改变显示文字。

```ts
import { applyEstimateLevel, calculateEnergyRange, calculateNutrients, createEstimatedFoodEntry } from '@shike/shared'

const entry = createEstimatedFoodEntry(personal, 200) // 输入没有指定档位时为 medium
if (entry.estimateProfile) {
  const ordinary = applyEstimateLevel(entry, 'medium')
  const richer = applyEstimateLevel(ordinary, 'high') // 返回新对象，保留记录 ID 和重量
  calculateEnergyRange(richer) // 按 200 g 缩放后的 { min, max } 或 null
  calculateNutrients(richer)   // 所选区间中值 × 200 / 100
}
```

`rangeMidpoint` 不提前取整；界面热量、重量、营养、范围和输入框统一最多显示两位小数，不补尾零；格式化不改写营养值或历史快照。`rangesToMidpoints` 保留未知字段为 `null`。`applyEstimateLevel` 复制完整三档资料，更新顶层营养值、AI 来源快照与选中假设；历史记录从已保存资料计算，模型或个人库后来更新不会改变旧记录。`calculateEnergyRange` 不会给没有范围的 USDA 数据、旧记录或手动确定数伪造 `[相同数, 相同数]`。明确吃了 0 g 的范围记录为 `[0,0]`；未知重量仍返回 `null`。

含独立油配料的本地参考配方以原油量为基准，少油范围为 0.5–0.8 倍、普通为 0.8–1.2 倍、多油为 1.2–1.6 倍。**这些倍数是食刻应用情景假设，不是烹饪标准。** 非油配料保持固定，每个端点为「非油配料营养总量 + 对应油量营养」，仅计算一次油；仍除以用户输入的固定成品重量。普通中值为原油量，少油中值为 0.65 倍，多油中值为 1.4 倍。切档还会更新配方快照中唯一的 `id: 'oil'` 配料重量。

配方档位中的 `oilWeightPer100g` 为每 100 g 成品的油克数范围，实际油重量为其中值乘成品重量除以 100。换份量后范围自然缩放，不能另加一次油。例如 208 g 西兰花配方原油量 8 g；多油档中值为 11.2 g，104 g 的同档份量则为 5.6 g。

用户知道确定热量或配料重量时，删除 `estimateProfile` 和 `estimateLevel`，保存手动确定值；确定数不能继续显示旧 AI 范围。共享校验要求：范围有限且非负、`min <= max`、各营养合法边界；若三档能量均已知，其上下端点按低中高不减（相同档位允许）。有范围的记录及 AI 快照营养必须等于所选中值，允许 `1e-7` 内浮点误差，`null` 也须一致。错误备份会被拒绝，不静默改写历史。

范围是 v2 备份里的可选扩展，本次不升级主版本；旧 v1／v2 的确定数记录仍然能导入。旧模型只返回单值时保留兼容，不凭空制造三档范围。
