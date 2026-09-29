// 提示词分组：admin（由 config/prompts.js 拆分而来，内容未改动）
// 可用变量见各模板的 description 字段。

module.exports = {
  admin_student_accounts: {
    group: '管理员工具',
    label: '学生账号批量生成',
    description: '管理员/班主任粘贴学生姓名后AI生成拼音账号。可用变量：{list_text}',
    default: `你是学校系统的账号生成助手。请为下列学生姓名分别生成一个登录账号（用户名）。

要求：
1. 账号使用姓名对应的汉语拼音，全部小写，只允许字母和数字，必须以字母开头，长度 4-20
2. 不要包含中文、空格、横线或其他特殊符号
3. 同一批内账号不能重复；遇到同名时用数字后缀区分（例如 zhangwei、zhangwei2）
4. 只输出严格 JSON 数组，不要任何解释、markdown 代码块或多余文字
5. 输出格式：[{"name":"张三","username":"zhangsan"}]

学生姓名：
{list_text}`
  }
};
