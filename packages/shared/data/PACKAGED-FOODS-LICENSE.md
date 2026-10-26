# Open Food Facts 包装商品子集的来源与许可

本目录的 `packaged-catalog-source.json` 和 `packaged-catalog-selection.json`，以及由其生成的 `../src/packaged-catalog.generated.ts`，含 Open Food Facts 公开商品数据库的精选子集及中文检索整理。

数据库来源：**Open Food Facts**，https://world.openfoodfacts.org/ 。商品取得日期：2026-10-16；具体取得时间与API URL见source JSON，每个条目的商品页见其`food.source.url`。项目目前选入1,053项，中文整理时剔除2条无法确认食品身份的记录。不声称覆盖整个数据库或中国市场，未逐件实物核对。

- 数据库采用 **Open Database License (ODbL) v1.0**：https://opendatacommons.org/licenses/odbl/1-0/ 。本精选数据库在相同许可下提供。
- 单项数据库内容采用 **Database Contents License (DbCL) v1.0**：https://opendatacommons.org/licenses/dbcl/1-0/ 。
- OFF 的 API 与许可说明：https://openfoodfacts.github.io/openfoodfacts-server/api/ 。
- 未下载、包含或再分发商品图片；图片的单独许可不被本项目代码许可替代。

再分发此子集或其衍生数据库时，保留 Open Food Facts 署名、来源链接和以上许可声明，并按 ODbL 要求提供可取得的数据库及适用的共享条款。随源码提供的 source JSON 是机器可读的原始入选内容，generated TS 为解析后的可读营养记录。中文展示名、别名及分类见 selection JSON，营养数值来自来源原值，未以 AI 生成数值补齐。

该数据声明不改变本项目代码或其他独立数据集的许可。USDA 基础食物与 OFF 包装数据分开维护；个人饮食、体重、Key 和私人照片不属于此公开数据子集。

社区数据可能缺失、过期或有误，未由本项目逐件核对实物。使用时核对相同条码、规格和当前营养标签；不要把公开参考当成实测结果。

2026-10-19补充OFF多语言分类中文词，源URL为https://static.openfoodfacts.org/data/taxonomies/categories.json，原始下载SHA-256及选存词条见`packaged-taxonomy-zh.json`。该分类数据库子集及中文检索衍生整理同样按上述ODbL／DbCL提供。类别提示不是完整商品译名；原名、品牌、条码及标签保持可核对。没有包含OFF服务端程序源码。
