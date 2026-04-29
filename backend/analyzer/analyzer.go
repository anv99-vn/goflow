package analyzer

import (
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Node represents a package-level component in the data flow graph
type Node struct {
	ID          string            `json:"id"`
	Label       string            `json:"label"`
	Package     string            `json:"package"`
	Functions   []FunctionInfo    `json:"functions"`
	Type        string            `json:"type"` // "entrypoint", "package", "external"
	Position    map[string]float64 `json:"position"`
}

// Edge represents data flow between two components
type Edge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"` // function call or data type
}

// FunctionInfo holds metadata about a function within a package
type FunctionInfo struct {
	Name       string   `json:"name"`
	Params     []string `json:"params"`
	Returns    []string `json:"returns"`
	CallsTo    []string `json:"callsTo"`    // packages this function calls into
	DataOps    []string `json:"dataOps"`    // data operations: merge, transform, filter...
	Body      string   `json:"body"`     // function body source code
}

// FuncNode is a function-level node in the call graph
type FuncNode struct {
	ID       string             `json:"id"`
	Label    string             `json:"label"`
	Package  string             `json:"package"`
	Params   []string           `json:"params"`
	Returns  []string           `json:"returns"`
	Position map[string]float64 `json:"position"`
}

// FuncEdge is a directed call edge between two functions
type FuncEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"` // argument expressions at call site(s)
}

// Graph is the full data flow graph
type Graph struct {
	Nodes         []Node     `json:"nodes"`
	Edges         []Edge     `json:"edges"`
	FunctionNodes []FuncNode `json:"functionNodes"`
	FunctionEdges []FuncEdge `json:"functionEdges"`
}

type pkgInfo struct {
	name      string
	path      string
	fset      *token.FileSet
	files     []*ast.File
	typeInfo  *types.Info
	functions []FunctionInfo
	imports   map[string]string // alias -> import path
}

// Analyze parses the Go project at rootDir and returns a data flow graph
func Analyze(rootDir string) (*Graph, error) {
	packages, err := loadPackages(rootDir)
	if err != nil {
		return nil, err
	}

	graph := &Graph{}
	nodeMap := map[string]*Node{}
	edgeSet := map[string]bool{}

	// Build nodes from packages
	for pkgPath, pkg := range packages {
		nodeID := sanitizeID(pkgPath)
		nodeType := "package"
		if pkg.name == "main" {
			nodeType = "entrypoint"
		}

		n := &Node{
			ID:        nodeID,
			Label:     pkg.name,
			Package:   pkgPath,
			Functions: pkg.functions,
			Type:      nodeType,
			Position:  map[string]float64{"x": 0, "y": 0},
		}
		nodeMap[pkgPath] = n
		graph.Nodes = append(graph.Nodes, *n)
	}

	// Build edges only between internal (project) packages — skip external deps
	edgeIdx := 0
	for srcPath, pkg := range packages {
		for _, fn := range pkg.functions {
			for _, calledPkg := range fn.CallsTo {
				// skip packages not in the project (external / stdlib)
				if _, exists := nodeMap[calledPkg]; !exists {
					continue
				}

				edgeKey := srcPath + "->" + calledPkg
				if !edgeSet[edgeKey] {
					edgeSet[edgeKey] = true
					graph.Edges = append(graph.Edges, Edge{
						ID:     "e" + string(rune('0'+edgeIdx)),
						Source: sanitizeID(srcPath),
						Target: sanitizeID(calledPkg),
						Label:  fn.Name,
					})
					edgeIdx++
				}
			}
		}
	}

	applyLayout(graph)

	graph.FunctionNodes, graph.FunctionEdges = buildFunctionGraph(packages)

	return graph, nil
}

func loadPackages(rootDir string) (map[string]*pkgInfo, error) {
	pkgs := map[string]*pkgInfo{}

	err := filepath.WalkDir(rootDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		// skip hidden dirs and vendor
		base := filepath.Base(path)
		if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" {
			return filepath.SkipDir
		}

		fset := token.NewFileSet()
		pkgsInDir, parseErr := parser.ParseDir(fset, path, nil, parser.ParseComments)
		if parseErr != nil {
			return nil
		}

		for pkgName, astPkg := range pkgsInDir {
			if strings.HasSuffix(pkgName, "_test") {
				continue
			}
			relPath, _ := filepath.Rel(rootDir, path)
			pkgPath := filepath.ToSlash(relPath)
			if pkgPath == "." {
				pkgPath = pkgName
			}

			var files []*ast.File
			for _, f := range astPkg.Files {
				files = append(files, f)
			}

			info := &pkgInfo{
				name:    pkgName,
				path:    pkgPath,
				fset:    fset,
				files:   files,
				imports: map[string]string{},
			}
			info.functions = extractFunctions(files, fset)
			pkgs[pkgPath] = info
		}
		return nil
	})

	return pkgs, err
}

func extractFunctions(files []*ast.File, fset *token.FileSet) []FunctionInfo {
	var fns []FunctionInfo

	for _, file := range files {
		// collect imports for this file
		fileImports := map[string]string{}
		for _, imp := range file.Imports {
			importPath := strings.Trim(imp.Path.Value, `"`)
			alias := lastSegment(importPath)
			if imp.Name != nil {
				alias = imp.Name.Name
			}
			fileImports[alias] = importPath
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}

			info := FunctionInfo{
				Name:    fn.Name.Name,
				Params:  extractFieldTypes(fn.Type.Params),
				Returns: extractFieldTypes(fn.Type.Results),
			}

			// extract function body source code
			var bodyBuf strings.Builder
			if err := printer.Fprint(&bodyBuf, fset, fn.Body); err == nil {
				info.Body = bodyBuf.String()
			}

			// find calls to other packages
			callSet := map[string]bool{}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				ident, ok := sel.X.(*ast.Ident)
				if !ok {
					return true
				}
				if pkgPath, exists := fileImports[ident.Name]; exists {
					callSet[pkgPath] = true
				}
				return true
			})

			for pkg := range callSet {
				info.CallsTo = append(info.CallsTo, pkg)
			}

			// detect data operations
			info.DataOps = detectDataOps(fn)

			fns = append(fns, info)
		}
	}
	return fns
}

func extractFieldTypes(fields *ast.FieldList) []string {
	if fields == nil {
		return nil
	}
	var types []string
	for _, field := range fields.List {
		t := typeString(field.Type)
		if len(field.Names) == 0 {
			types = append(types, t)
		} else {
			for _, name := range field.Names {
				types = append(types, name.Name+": "+t)
			}
		}
	}
	return types
}

func typeString(expr ast.Expr) string {
	if expr == nil {
		return ""
	}
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return "*" + typeString(t.X)
	case *ast.SelectorExpr:
		return typeString(t.X) + "." + t.Sel.Name
	case *ast.ArrayType:
		return "[]" + typeString(t.Elt)
	case *ast.MapType:
		return "map[" + typeString(t.Key) + "]" + typeString(t.Value)
	case *ast.InterfaceType:
		return "interface{}"
	case *ast.ChanType:
		return "chan " + typeString(t.Value)
	case *ast.FuncType:
		return "func"
	case *ast.Ellipsis:
		return "..." + typeString(t.Elt)
	}
	return "unknown"
}

func detectDataOps(fn *ast.FuncDecl) []string {
	ops := map[string]bool{}
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.RangeStmt:
			ops["iterate"] = true
		case *ast.IfStmt:
			ops["filter"] = true
		case *ast.AssignStmt:
			if len(node.Rhs) > 0 {
				if _, ok := node.Rhs[0].(*ast.CompositeLit); ok {
					ops["transform"] = true
				}
			}
		case *ast.CallExpr:
			if sel, ok := node.Fun.(*ast.SelectorExpr); ok {
				switch sel.Sel.Name {
				case "Append", "append":
					ops["merge"] = true
				case "Copy", "copy":
					ops["copy"] = true
				}
			}
		}
		return true
	})

	var result []string
	for op := range ops {
		result = append(result, op)
	}
	return result
}

// applyLayout assigns x/y positions using a simple layered layout
func applyLayout(g *Graph) {
	layers := map[string]int{}
	// entrypoint = layer 0
	for i, n := range g.Nodes {
		if n.Type == "entrypoint" {
			layers[n.ID] = 0
			_ = i
		}
	}

	// BFS to assign layers
	changed := true
	for changed {
		changed = false
		for _, e := range g.Edges {
			srcLayer, ok := layers[e.Source]
			if !ok {
				continue
			}
			tgtLayer, exists := layers[e.Target]
			if !exists || tgtLayer < srcLayer+1 {
				layers[e.Target] = srcLayer + 1
				changed = true
			}
		}
	}

	// group by layer
	layerNodes := map[int][]int{}
	for i, n := range g.Nodes {
		l := layers[n.ID]
		layerNodes[l] = append(layerNodes[l], i)
	}

	xSpacing := 250.0
	ySpacing := 150.0
	for layer, indices := range layerNodes {
		for j, idx := range indices {
			g.Nodes[idx].Position["x"] = float64(layer) * xSpacing
			g.Nodes[idx].Position["y"] = float64(j) * ySpacing
		}
	}
}

func sanitizeID(s string) string {
	r := strings.NewReplacer("/", "_", ".", "_", "-", "_", " ", "_")
	return r.Replace(s)
}

func lastSegment(path string) string {
	parts := strings.Split(path, "/")
	return parts[len(parts)-1]
}

// buildFunctionGraph produces a function-level call graph for all packages.
// It tracks intra-package calls (simple identifier calls, not pkg.Method).
func buildFunctionGraph(packages map[string]*pkgInfo) ([]FuncNode, []FuncEdge) {
	type funcKey struct{ pkg, name string }

	// Build node ID map and node list
	funcIDs := map[funcKey]string{}
	var nodes []FuncNode

	for pkgPath, pkg := range packages {
		for _, fn := range pkg.functions {
			id := sanitizeID(pkgPath + "__" + fn.Name)
			funcIDs[funcKey{pkgPath, fn.Name}] = id
			nodes = append(nodes, FuncNode{
				ID:       id,
				Label:    fn.Name,
				Package:  pkgPath,
				Params:   fn.Params,
				Returns:  fn.Returns,
				Position: map[string]float64{"x": 0, "y": 0},
			})
		}
	}

	// Collect call edges: caller → callee with argument strings
	type callRecord struct {
		source, target string
		args           []string
	}
	edgeArgs := map[string][]string{} // "src->tgt" → []argStr per call site

	for pkgPath, pkg := range packages {
		pkgFuncs := map[string]bool{}
		for _, fn := range pkg.functions {
			pkgFuncs[fn.Name] = true
		}

		for _, file := range pkg.files {
			for _, decl := range file.Decls {
				fnDecl, ok := decl.(*ast.FuncDecl)
				if !ok || fnDecl.Body == nil {
					continue
				}
				callerName := fnDecl.Name.Name
				callerID, callerKnown := funcIDs[funcKey{pkgPath, callerName}]
				if !callerKnown {
					continue
				}

				ast.Inspect(fnDecl.Body, func(n ast.Node) bool {
					call, ok := n.(*ast.CallExpr)
					if !ok {
						return true
					}
					ident, ok := call.Fun.(*ast.Ident)
					if !ok {
						return true // skip pkg.Method and method calls
					}
					calleeName := ident.Name
					if !pkgFuncs[calleeName] || calleeName == callerName {
						return true
					}
					calleeID := funcIDs[funcKey{pkgPath, calleeName}]
					argParts := make([]string, len(call.Args))
					for i, a := range call.Args {
						argParts[i] = exprString(a)
					}
					key := callerID + "->" + calleeID
					edgeArgs[key] = append(edgeArgs[key], strings.Join(argParts, ", "))
					return true
				})
			}
		}
	}

	// Build edges
	var edges []FuncEdge
	edgeIdx := 0
	for key, calls := range edgeArgs {
		parts := strings.SplitN(key, "->", 2)
		label := calls[0]
		if len(calls) > 1 {
			label = "×" + strconv.Itoa(len(calls)) + ": " + strings.Join(calls, " | ")
		}
		edges = append(edges, FuncEdge{
			ID:     "fe" + strconv.Itoa(edgeIdx),
			Source: parts[0],
			Target: parts[1],
			Label:  label,
		})
		edgeIdx++
	}

	applyFuncLayout(nodes, edges)
	return nodes, edges
}

// exprString converts an AST expression to a readable string for edge labels.
func exprString(expr ast.Expr) string {
	switch e := expr.(type) {
	case *ast.BasicLit:
		return e.Value
	case *ast.Ident:
		return e.Name
	case *ast.CallExpr:
		fnStr := exprString(e.Fun)
		args := make([]string, len(e.Args))
		for i, a := range e.Args {
			args[i] = exprString(a)
		}
		return fnStr + "(" + strings.Join(args, ", ") + ")"
	case *ast.SelectorExpr:
		return exprString(e.X) + "." + e.Sel.Name
	case *ast.BinaryExpr:
		return exprString(e.X) + " " + e.Op.String() + " " + exprString(e.Y)
	case *ast.UnaryExpr:
		return e.Op.String() + exprString(e.X)
	}
	return "_"
}

// applyFuncLayout assigns positions using BFS from "main" functions.
func applyFuncLayout(nodes []FuncNode, edges []FuncEdge) {
	layers := map[string]int{}
	for i := range nodes {
		if nodes[i].Label == "main" {
			layers[nodes[i].ID] = 0
		}
	}

	changed := true
	for changed {
		changed = false
		for _, e := range edges {
			srcLayer, ok := layers[e.Source]
			if !ok {
				continue
			}
			tgtLayer, exists := layers[e.Target]
			if !exists || tgtLayer < srcLayer+1 {
				layers[e.Target] = srcLayer + 1
				changed = true
			}
		}
	}

	maxLayer := 0
	for _, l := range layers {
		if l > maxLayer {
			maxLayer = l
		}
	}
	for i := range nodes {
		if _, ok := layers[nodes[i].ID]; !ok {
			layers[nodes[i].ID] = maxLayer + 1
		}
	}

	layerNodes := map[int][]int{}
	for i, n := range nodes {
		l := layers[n.ID]
		layerNodes[l] = append(layerNodes[l], i)
	}

	xSpacing := 280.0
	ySpacing := 160.0
	for layer, indices := range layerNodes {
		for j, idx := range indices {
			nodes[idx].Position["x"] = float64(layer) * xSpacing
			nodes[idx].Position["y"] = float64(j) * ySpacing
		}
	}
}
