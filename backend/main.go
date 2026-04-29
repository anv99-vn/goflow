package main

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"goflow/backend/analyzer"
)

//go:embed dist
var distFS embed.FS

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/analyze", handleAnalyze)
	mux.HandleFunc("/api/analyze-file", handleAnalyzeFile)
	mux.HandleFunc("/api/health", handleHealth)
	mux.Handle("/", spaHandler())

	log.Println("GoFlow running on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}

// spaHandler serves the embedded frontend and falls back to index.html for SPA routing
func spaHandler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file; fall back to index.html for client-side routes
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(sub, path); err != nil {
			// File not found → serve index.html (SPA fallback)
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func handleAnalyze(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Path string `json:"path"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Path == "" {
		http.Error(w, "invalid request: path is required", http.StatusBadRequest)
		return
	}

	graph, err := analyzer.Analyze(req.Path)
	if err != nil {
		http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(graph)
}

func handleAnalyzeFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 50 MB limit for multiple files
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		http.Error(w, "failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	fileHeaders := r.MultipartForm.File["file"]
	if len(fileHeaders) == 0 {
		http.Error(w, "at least one file is required", http.StatusBadRequest)
		return
	}

	tmpDir, err := os.MkdirTemp("", "goflow-*")
	if err != nil {
		http.Error(w, "failed to create temp dir: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(tmpDir)

	for _, fh := range fileHeaders {
		if !strings.HasSuffix(fh.Filename, ".go") {
			continue // skip non-Go files silently
		}
		f, err := fh.Open()
		if err != nil {
			http.Error(w, "failed to open file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		content, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			http.Error(w, "failed to read file: "+err.Error(), http.StatusInternalServerError)
			return
		}
		if err := os.WriteFile(filepath.Join(tmpDir, fh.Filename), content, 0644); err != nil {
			http.Error(w, "failed to write temp file: "+err.Error(), http.StatusInternalServerError)
			return
		}
	}

	graph, err := analyzer.Analyze(tmpDir)
	if err != nil {
		http.Error(w, "analysis failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(graph)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
