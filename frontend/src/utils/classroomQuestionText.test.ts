import { describe, it, expect } from 'vitest';
import { splitInlineOptions, looksLikeJudgment, inferTypeFromOptions } from './classroomQuestionText';

describe('splitInlineOptions', () => {
  it('识别题干内嵌的 A.B.C.D（选项紧跟标点，无空格）', () => {
    const r = splitInlineOptions('《悯农二首》的作者是哪位唐代诗人？A.李白 B.李绅 C.杜甫 D.白居易');
    expect(r).not.toBeNull();
    expect(r!.stem).toBe('《悯农二首》的作者是哪位唐代诗人？');
    expect(r!.options.map(o => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(r!.options[1].text).toBe('李绅');
  });

  it('支持 A．A、 A) A） 等分隔符', () => {
    expect(splitInlineOptions('下面哪项正确？A．甲 B．乙')!.options[0].text).toBe('甲');
    expect(splitInlineOptions('下面哪项正确？A、甲 B、乙')!.options[1].text).toBe('乙');
    expect(splitInlineOptions('下面哪项正确？A)甲 B)乙')!.options[0].text).toBe('甲');
    expect(splitInlineOptions('下面哪项正确？A）甲 B）乙')!.options[0].text).toBe('甲');
  });

  it('支持换行分隔的选项', () => {
    const r = splitInlineOptions('下列说法正确的是\nA. 甲\nB. 乙\nC. 丙');
    expect(r!.options.map(o => o.text)).toEqual(['甲', '乙', '丙']);
  });

  it('字母不连续时放弃（宁可不认也不误判）', () => {
    expect(splitInlineOptions('题干？B.甲 C.乙 D.丙')).toBeNull();
    expect(splitInlineOptions('题干？A.甲 C.乙')).toBeNull();
  });

  it('只有一个选项时放弃', () => {
    expect(splitInlineOptions('题干？A.甲')).toBeNull();
  });

  it('简答题不解析', () => {
    expect(splitInlineOptions('请说出李绅《悯农·其二》中点明粮食来之不易的两句诗是？')).toBeNull();
    expect(splitInlineOptions('')).toBeNull();
  });

  it('选项内容为空时放弃', () => {
    expect(splitInlineOptions('题干？A. B. 乙')).toBeNull();
  });

  it('识别判断题形态', () => {
    const r = splitInlineOptions('水在100摄氏度沸腾。A.正确 B.错误');
    expect(looksLikeJudgment(r!.options)).toBe(true);
    expect(inferTypeFromOptions(r!.options)).toBe('judgment');
  });

  it('非判断题形态按单选处理', () => {
    const r = splitInlineOptions('作者是谁？A.李白 B.李绅 C.杜甫 D.白居易');
    expect(looksLikeJudgment(r!.options)).toBe(false);
    expect(inferTypeFromOptions(r!.options)).toBe('choice_single');
  });
});
