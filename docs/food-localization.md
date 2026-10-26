# 食物中文名称与第二轮中式扩库

当前可选普通食物5,880项（原始参考5,982条）、可调配方90个、包装参考1,053款。翻译本身不增加食品数量，也不改变营养数值。本轮实际增加132条官方参考、20个参考配方。

## 使用方式

手动添加 → 选择食物，直接搜中文名称，例如“酸奶分层甜品”“茶叶蛋”“莲雾”“杨桃”“珍珠奶茶半糖”“皮蛋瘦肉粥”。原文、旧名称、品牌和条码仍可搜索。包装库也显示中文名称及原名。

本轮对992项普通食物展示名做了补译或名称修正。普通食品展示名均含中文；仍有149项保留拉丁词，主要为品牌、外来专名或USDA／TFDA等缩写，没有用删除英文的方式假装全部完成翻译。“whole milk”改为全脂奶，“Goat milk”改为山羊奶，修正旧词表逐词组合导致的误译。具体改动与仍保留的原文见`packages/shared/data/food-translation-report.json`。

包装库有954项带中文（包含原有中文名、中文补译和类别提示），其中609项使用补译，147项只有可靠的中文类别提示。99项仍无法给出可靠中文名称，保留原文。**类别提示不是完整商品译名**：例如只有OFF“饼干”分类可用时显示“饼干 · 原商品名”，并明确提示。不会把未知外国品牌硬译成另一家国内品牌。

完整的原有中文商品名优先，例如“特仑苏纯牛奶”不会被源站泛称“纯牛奶”取代。中文补译保留“无糖”与“无添加糖”的区别；人工牛肉风味不会写成实际牛肉，热巧克力不会误译为辣巧克力。译名参考不能替代实物配料及过敏原信息。

名称整理时发现2条无法确认食品身份的记录，已退出新餐选择：一条仅名为“Ggghg”，一条名为“Castor oil”且无法确认食用级身份。原始公开记录与原因保存在`packaged-name-review.json`，没有为其猜造中文食品名；历史餐食快照仍保留。

## 新增食品

TFDA子集从175条增至307条，沿用2026-10-19已下载并核实许可的官方原始文件，没有再次请求每个食品。包括：

- 茶叶蛋、卤蛋、皮蛋、熟咸鸭蛋、温泉蛋、鹌鹑蛋及鸡蛋羹等不同做法。
- 莲雾、杨桃、红心火龙果、山竹、龙眼、枇杷、释迦、余甘子、嘉宝果等水果。
- 珍珠奶茶／乌龙奶茶的微糖、半糖、全糖样本，鲜奶茶、冬瓜茶、仙草蜜、咸豆浆等饮品；这些是指定样本，每100g数据不能假装成每100mL。
- 部分奶制品、熟芝麻、熟菱角、肉松、鱼松、罐头蔬菜及豆制品。

没有将全部水果品种或不同采样月份逐项堆入列表。可直接食用的水果允许保留原始生果样本；生肉、未烹调制品、冷冻半成品没有因此混入即食列表。官方平均值条目保留其原编号，不编造统一采样年份。

配方从70个增至90个，包括青椒炒鸡蛋、胡萝卜炒鸡蛋、洋葱炒肉片、香菇烧豆腐、皮蛋瘦肉粥、香菇鸡肉粥、豆腐虾仁汤、番茄鸡蛋盖饭等。配料均使用注明的熟食／即食参考，清楚标示近似与缺少的酱料。已有“番茄豆腐”只新增常见别名，不重复创建一条近似配方。

## 实现和复现

普通食品保留原始营养生成表，另维护独立中文名称表：

1. `food-name-glossary.mjs`提供离线词表与少量逐项修正，仅输入名称，不生成营养值。
2. `localize-food-names.mjs`从原始生成表生成`food-names.zh.generated.ts`，不从已翻译结果再次翻译。
3. `food-localization.ts`叠加展示名、原文和旧名别名；ID、来源、生熟状态和营养不变。
4. 先用原始名称进行已有近似项整理，再加译名，防止翻译长度改变代表ID。

包装商品使用`packaged-name-zh.mjs`离线词表，并读取[OFF官方多语言分类](https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/taxonomy/get-api-v3-taxonomy-display-tags/)的中文名称。分类静态文件来自`https://static.openfoodfacts.org/data/taxonomies/categories.json`；只选存用到的中文分类词，保留URL、下载时间和SHA-256在`packaged-taxonomy-zh.json`。数据库及衍生整理按OFF的ODbL／DbCL声明提供，详见[包装许可](../packages/shared/data/PACKAGED-FOODS-LICENSE.md)。代码没有引入Product Opener服务端实现。

重现当前文件，不需要模型Key，也不会批量联网：

```powershell
npm install
npm run build -w @shike/shared
node scripts/import-chinese-foods.mjs
npm run build -w @shike/shared
node scripts/localize-food-names.mjs
node scripts/localize-packaged-names.mjs
node scripts/import-packaged-catalog.mjs packages/shared/data/packaged-catalog-source.json
npm run build -w @shike/shared
node scripts/report-food-curation.mjs
npm test
npm run build
```

扩展TFDA白名单需要原始文件时，使用`node scripts/import-chinese-foods.mjs --source .data-cache/tfda/official/20_5.json`。这里沿用官方样本值，保留单位和缺失值。首次更新OFF分类词时，显式下载该静态JSON后，执行`node scripts/localize-packaged-names.mjs --taxonomy 文件路径`；普通运行使用仓库快照，不会联网。OpenCC仅在开发导入时做简体转换，不进入手机运行时。

## 历史和测试范围

已保存的餐食采用自己的名称、每100g数值、配料和来源快照；本次没有迁移或重算历史，没有改变v8备份结构。原名称保持检索，旧ID仍能恢复；个人同条码标签继续优先。

测试覆盖每一原始食品的营养及来源不变、合并代表ID不变、旧名检索、全脂奶等误译、糖与风味限定、类别提示、包装原始标签不变、熟重份量换算、中文／原文搜索及保存刷新。不调用真实模型。

2026-10-19实际完成：285项单元／接口测试、类型检查、生产及Android构建通过；33项Chrome手机视口、Chrome桌面、Edge场景完成验证。首轮包装原名断言误含品牌，按源站真实字段修正后6项专项复测通过（包含重叠场景）。最终APK解包资源在API和外部请求被拦截的情况下，12项选取／保存／刷新／中文及原文检索复测全部通过。

独立APK为0.9.3-test（versionCode 13），10,606,123 bytes，SHA-256为`82786947209adb8f1191df0e6aef8e362ca16540f482e311c54b0990eaddcfce`。下载文件校验一致，与0.9.2签名相同；TFDA和OFF署名文件均已核对打包。先导出备份再覆盖安装，不需卸载。没有真机光学清晰度复测；本轮不声称已解决OPPO Find X9的所有对焦问题。
