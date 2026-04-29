# Changelog

All notable changes to this project are documented here.

## 2026-04-29

### ✨ Features
- Add function-level call graph and multi-file upload improvements
  - `FuncNode`/`FuncEdge` structs với AST-based argument extraction
  - Toggle Package / Function view trong stats bar
  - `FunctionNode.tsx` component với syntax-highlighted detail panel
  - Missing function detection — node màu đỏ khi hàm được gọi nhưng chưa định nghĩa
  - Lưu vị trí node vào `localStorage` sau khi kéo
  - Layout đảo ngược: entrypoint bên phải, dependency bên trái
- Add multi-file picker with per-file remove chips
  - Tích lũy file qua nhiều lần chọn (dedup theo tên)
  - Nút ✕ xóa từng file, tự re-analyze
  - Dùng `<label>` wrap `<input multiple>` để multi-select hoạt động đúng trên Windows

### 🐛 Bug Fixes
- File input chỉ cho chọn 1 file do programmatic `.click()` không truyền `multiple` đúng trên Windows
- `analyzeFiles` được gọi bên trong `setState` callback (React anti-pattern) — chuyển sang `useEffect`
- `accept=".go"` gây OS dialog giới hạn single-file — đã xóa, filter giữ ở JS

### ♻️ Refactor
- `handleAnalyzeFile` gom file upload theo `package` declaration vào subdirectory riêng để multi-package analysis hoạt động đúng
- `parsePackageName` đọc package declaration từ source bytes

### 📝 Docs
- Add CLAUDE.md with project architecture and build instructions

### 🔧 Other
- Initial commit: GoFlow — Go source code data flow visualizer
