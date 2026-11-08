# -*- coding: utf-8 -*-
"""测试脚本的下载目录与调试端口约定（2026-11-08）。

背景（苏哥反馈）：
    多个 bili-* / cdp-* 脚本把 DL_DIR 写死成 `E:\\personal\\Downloads`，
    有的还连 9223（日常浏览器）并下发 Browser.setDownloadBehavior。
    结果：跑一次测试就往自己的下载文件夹里塞文件，甚至让人以为
          扩展改了他的下载设置。

约定：
    1. 测试产物一律落在仓库外 `..\\work\\`（规范见 docs/ARTIFACT-MANAGEMENT.md §3），
       跑完可整目录删除。仓库内的 `.work/` 仅作历史兼容回退。
    2. 绝不默认写用户的 shell:Downloads。
    3. 需要真实下载目录时，显式传环境变量 VR_DL_ROOT。
    4. 连日常浏览器（9223）的脚本必须显式确认，不静默使用。
"""
import os
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def work_root():
    """测试工作区根目录。

    优先级：
      VR_WORK（显式指定）> ..\\work\\（仓库外，正式位置）> .work\\（仓库内，历史兼容）

    返回路径不保证已创建；调用方按需 os.makedirs(exist_ok=True)。
    """
    env = os.environ.get("VR_WORK", "").strip()
    if env:
        return env

    out_of_repo = os.path.join(os.path.dirname(ROOT), "work")
    if os.path.isdir(out_of_repo):
        return out_of_repo
    return os.path.join(ROOT, ".work")


def work_path(*parts):
    """工作区内的子路径（自动建父目录）。"""
    path = os.path.join(work_root(), *parts)
    os.makedirs(path, exist_ok=True)
    return path


def dl_dir(tag="misc"):
    """本次运行专用的下载目录（自动创建）。

    优先级：
      VR_DL_ROOT（显式指定，用户自担风险）> <work_root>/dl/<tag>-<stamp>
    """
    env = os.environ.get("VR_DL_ROOT", "").strip()
    if env:
        os.makedirs(env, exist_ok=True)
        return env

    stamp = time.strftime("%Y%m%d-%H%M%S")
    path = os.path.join(work_root(), "dl", "%s-%s" % (tag, stamp))
    os.makedirs(path, exist_ok=True)
    return path


def warn_daily_browser(port):
    """连日常浏览器时打印醒目提示：会动到用户真实配置。"""
    print("[注意] 正在连日常浏览器实例 port=%d。" % port)
    print("       本脚本只会下载文件到测试目录，不会修改浏览器的下载设置；")
    print("       若需完全隔离，请改用 tools/vr-session.py（端口 9480）。")
