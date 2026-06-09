import asyncio
import os
import sys

from services.export_task_service import ExportTaskService
from services.liteparse_service import LiteParseService
from utils.runtime_limits import BoundedTextBuffer


def test_bounded_text_buffer_keeps_only_tail():
    buffer = BoundedTextBuffer(limit=5)
    buffer.append("abcdef")
    buffer.append("gh")

    value = buffer.get()

    assert "defgh" in value
    assert "truncated 3 chars" in value


def test_liteparse_plain_bridge_keeps_stdout_and_bounds_stderr(tmp_path):
    service = LiteParseService(timeout_seconds=10)
    service._npm_project_root = str(tmp_path)

    process = service._run_plain_bridge_to_text(
        [
            sys.executable,
            "-c",
            "import sys; sys.stdout.write('x' * 5000); sys.stderr.write('e' * 10000)",
        ]
    )

    assert process.returncode == 0
    assert len(process.stdout) == 5000
    assert "truncated" in process.stderr


def test_export_child_output_is_bounded(tmp_path):
    service = ExportTaskService(timeout_seconds=10)

    result = asyncio.run(
        service._run_bounded_child(
            [
                sys.executable,
                "-c",
                "import sys; sys.stdout.write('o' * 10000); sys.stderr.write('e' * 10000); sys.exit(7)",
            ],
            cwd=str(tmp_path),
            env=os.environ.copy(),
            timeout=10,
        )
    )

    assert result["returncode"] == 7
    assert "truncated" in str(result["stdout"])
    assert "truncated" in str(result["stderr"])


def test_export_converter_resolver_accepts_linux_amd64_name(tmp_path, monkeypatch):
    monkeypatch.delenv("BUILT_PYTHON_MODULE_PATH", raising=False)
    monkeypatch.setattr("services.export_task_service.sys_platform", lambda: "linux")
    monkeypatch.setattr("services.export_task_service.sys_arch", lambda: "x64")
    converter = tmp_path / "py" / "convert-linux-amd64"
    converter.parent.mkdir()
    converter.write_text("binary")

    assert ExportTaskService._resolve_converter_path(str(tmp_path)) == str(converter)


def test_export_converter_resolver_prefers_existing_configured_path(
    tmp_path, monkeypatch
):
    configured = tmp_path / "custom-converter"
    configured.write_text("binary")
    converter = tmp_path / "py" / "convert-linux-x64"
    converter.parent.mkdir()
    converter.write_text("binary")
    monkeypatch.setenv("BUILT_PYTHON_MODULE_PATH", str(configured))

    assert ExportTaskService._resolve_converter_path(str(tmp_path)) == str(configured)
