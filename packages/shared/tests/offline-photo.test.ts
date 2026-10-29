import { describe, expect, it } from 'vitest';
import { parseOfflinePhotoNames } from '../src/index.js';

describe('本机照片名称清单', () => {
  it('接受带或不带序号的完整短清单，保留生熟与做法', () => {
    expect(parseOfflinePhotoNames('1. 米饭\n2. 清蒸鸡肉\n3. 西兰花（熟）')).toEqual(['米饭', '清蒸鸡肉', '西兰花（熟）']);
    expect(parseOfflinePhotoNames(' - 鸡蛋\n - 馒头 ')).toEqual(['鸡蛋', '馒头']);
  });
  it('非食物返回空列表，不塞入默认食品', () => {
    expect(parseOfflinePhotoNames('未识别到食物。')).toEqual([]);
  });
  it('重复、长清单与用户回传的调料循环不能部分进入餐食', () => {
    for (const raw of ['蔬菜\n蔬菜', '1. 蒜\n2. 葱花\n3. 黑胡椒\n4. 盐\n5. 酱油\n6. 醋\n7. 辣椒油', '米饭\n米 饭']) expect(() => parseOfflinePhotoNames(raw)).toThrow();
  });
  it('拒绝重量、营养、解释、不确定名称与未写完的编号', () => {
    for (const raw of ['', '米饭\n2.', '米饭100g', '米饭：150克', '鸡蛋2个', '照片中有米饭', '西兰花（不确定）', '米饭，鸡肉', '米饭\n蛋白质20g', '```json\n["米饭"]\n```', '菜'.repeat(41)]) expect(() => parseOfflinePhotoNames(raw)).toThrow();
  });
});
