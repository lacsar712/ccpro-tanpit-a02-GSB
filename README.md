# TanPit-01 · 南冈鞣场

鞣坑场地图作业台。登录后是按行列铺开的坑位，点坑登记浸液酸碱度并改状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Django 5 · Django Ninja（不是 DRF 视图集） |
| 结构 | Django app `pits`：models / rules / api 分文件 |
| 数据 | Django ORM · PostgreSQL 15 |
| 前端 | Lit 3 Web Component · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4770
- API：http://localhost:8770
- PostgreSQL：localhost:6170

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

坑不可标「已放液」，除非最近一次浸液酸碱度在 **3.5～5.0**。规则在 `backend/pits/rules.py`。

「注液」改「鞣制中」须该坑有**未作废转速卡**且转数在 **8～14 转/分**（含）；没有卡或转数出区间都挡住。已放液继续只认酸碱带，转速卡不参与。

## 转速卡

顶栏「转速卡」专页用刻度条建卡：按坑筛列表、写入每分钟转数。卡记下坑码、从 1 起的卡号、正整数转数、测定人和测定时刻，作废栏可空白。同坑未作废卡号不得撞号（数据库部分唯一约束兜底，并发抢交同号时后到一笔落空）。操作工可建卡，只有值班长（admin）可作废。种子数据只有一口注液坑、零张卡。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
