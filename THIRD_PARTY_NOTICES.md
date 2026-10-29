# 第三方组件声明

## @capacitor/app 8.1.2

安卓返回手势与前后台事件使用官方App插件（MIT，Copyright 2020-present Ionic），未修改插件源码。

- 完整许可附于应用资源`licenses/capacitor-app-MIT.txt`。
- 上游源码：https://github.com/ionic-team/capacitor-plugins/tree/main/app

## @capgo/camera-preview 8.12.5

0.11.24-test起Android安装包不再包含该原生插件及其CameraX依赖，改用系统相机；旧版源码与前端兼容适配仍保留，相关许可声明亦保留。

食刻安卓相机预览与静态拍照使用本插件，原样使用其发布源码，未修改插件源文件。该组件以 **Mozilla Public License 2.0（MPL-2.0）** 发布；食刻业务代码不因此改用该许可证。

- 发布包及完整对应源文件：https://www.npmjs.com/package/@capgo/camera-preview/v/8.12.5
- 上游源码：https://github.com/Cap-go/capacitor-camera-preview
- MPL-2.0全文随依赖包提供，应用内资源亦提供`licenses/capgo-camera-preview-MPL-2.0.txt`。
- Android实现使用CameraX等依赖，其各自权利与许可继续适用。

本插件与Capgo的可选云服务相互独立；本项目没有配置Capgo账户、更新服务或云端部署。

## 食品数据

Open Food Facts包装商品子集的ODbL／DbCL来源及声明见[包装数据许可](packages/shared/data/PACKAGED-FOODS-LICENSE.md)。USDA数据与其独立维护。

OFF中文分类词子集来自其公开多语言分类数据库，取得时间与校验值见`packages/shared/data/packaged-taxonomy-zh.json`，同样保留ODbL／DbCL声明；APK附`licenses/open-food-facts.txt`。商品名补译和类别提示保留原名，不改变营养值。

TFDA食品营养成分数据采用政府资料开放授权条款第1版，来源及修改声明见[中式食品许可](packages/shared/data/CHINESE-FOODS-LICENSE.md)，应用内附`licenses/tfda-foods.txt`。

开发时名称转换使用opencc-js 1.4.2（MIT，The nk2028 Project）；完整许可见其发布包。此工具仅用于离线导入，不作为相机、AI或运行时网络服务。

## 离线AI测试依赖（0.11.21-test新增）

- Google LiteRT-LM Android 0.18.1：Apache-2.0，https://github.com/google-ai-edge/LiteRT-LM 。
- Qwen2.5-1.5B-Instruct / LiteRT community转换版：Apache-2.0，https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct 、https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct 。模型由用户下载/导入，不随APK分发；固定版本及校验见 docs/offline-ai.md。

## 离线视觉测试模型（0.11.26-test新增）

- Qwen3.5-0.8B原模型及LiteRT community视觉转换版：Apache-2.0，https://huggingface.co/Qwen/Qwen3.5-0.8B 、https://huggingface.co/litert-community/Qwen3.5-0.8B 。转换版为社区发布，不代表Qwen团队官方维护或认证。
- 由用户另外下载/导入，不随APK分发，食刻未修改模型权重；固定版本、SHA-256及使用限制见 [离线视觉测试说明](docs/offline-vision.md)。继续使用既有LiteRT-LM 0.18.1及随包Apache-2.0许可。
