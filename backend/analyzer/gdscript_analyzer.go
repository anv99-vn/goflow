package analyzer

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	reGDExtends    = regexp.MustCompile(`^extends\s+(.+)`)
	reGDClassName  = regexp.MustCompile(`^class_name\s+(\w+)`)
	reGDFunc       = regexp.MustCompile(`^(\s*)func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\S+))?:`)
	reGDVar        = regexp.MustCompile(`^(?:@\w+\s+)*var\s+(\w+)(?:\s*:\s*([\w\[\],\s]+))?`)
	reGDSignal     = regexp.MustCompile(`^signal\s+(\w+)(?:\s*\(([^)]*)\))?`)
	reGDPreload    = regexp.MustCompile(`preload\s*\(\s*"([^"]+)"\s*\)`)
	reGDInnerClass = regexp.MustCompile(`^(\s*)class\s+(\w+)`)
	reGDCallSimple = regexp.MustCompile(`\b([a-z_]\w*)\s*\(`)
)

// gdscriptBuiltins lists GDScript built-in identifiers that should not generate missing nodes.
var gdscriptBuiltins = map[string]bool{
	"abs": true, "acos": true, "asin": true, "atan": true, "atan2": true,
	"ceil": true, "clamp": true, "cos": true, "cosh": true, "deg_to_rad": true,
	"deg2rad": true, "ease": true, "floor": true, "fmod": true, "fposmod": true,
	"inverse_lerp": true, "is_equal_approx": true, "is_inf": true, "is_nan": true,
	"is_zero_approx": true, "lerp": true, "lerp_angle": true, "linear2db": true,
	"log": true, "max": true, "min": true, "move_toward": true, "nearest_po2": true,
	"pingpong": true, "posmod": true, "pow": true, "rad_to_deg": true,
	"rad2deg": true, "range": true, "range_lerp": true, "round": true,
	"sign": true, "sin": true, "sinh": true, "smoothstep": true, "snapped": true,
	"sqrt": true, "step_decimals": true, "stepify": true, "tan": true, "tanh": true,
	"wrap": true, "wrapf": true, "wrapi": true,
	"print": true, "print_debug": true, "print_stack": true, "printerr": true,
	"printraw": true, "prints": true, "printt": true, "push_error": true, "push_warning": true,
	"str": true, "str_to_var": true, "var_to_str": true, "var_to_bytes": true,
	"bytes_to_var": true, "typeof": true, "type_exists": true,
	"int": true, "float": true, "bool": true, "len": true,
	"assert": true, "yield": true, "await": true, "pass": true,
	"emit_signal": true, "call": true, "callv": true, "connect": true, "disconnect": true,
	"get_node": true, "get_node_or_null": true, "find_node": true, "find_child": true,
	"has_node": true, "has_node_and_resource": true, "add_child": true,
	"remove_child": true, "queue_free": true, "free": true,
	"set": true, "get": true, "has_method": true, "has_signal": true,
	"preload": true, "load": true, "inst_to_dict": true, "dict_to_inst": true,
	"randi": true, "randf": true, "randi_range": true, "randf_range": true,
	"randomize": true, "seed": true,
	"is_instance_valid": true, "is_instance_of": true, "weakref": true,
	"super": true, "self": true,
}

type gdScriptInfo struct {
	path     string
	name     string // class_name or filename stem
	extends  string
	isMain   bool
	funcs    []FunctionInfo
	structs  []StructInfo       // inner classes
	deps     []string           // res:// dependency paths
	preloads map[string]string  // var_name -> res:// path
}

// AnalyzeGDScript parses the GDScript project at rootDir and returns a data flow graph.
func AnalyzeGDScript(rootDir string) (*Graph, error) {
	scripts := make(map[string]*gdScriptInfo)

	err := filepath.WalkDir(rootDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if strings.HasPrefix(name, ".") || name == "addons" || name == ".godot" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".gd") {
			return nil
		}
		info, parseErr := parseGDScriptFile(path)
		if parseErr != nil {
			return nil
		}
		scripts[path] = info
		return nil
	})
	if err != nil {
		return nil, err
	}

	if len(scripts) == 0 {
		return &Graph{Language: "gdscript"}, nil
	}

	// Build class_name → path index for resolving extends
	classNameToPath := make(map[string]string)
	for p, info := range scripts {
		if info.name != "" {
			stem := strings.TrimSuffix(filepath.Base(p), ".gd")
			if info.name != stem {
				classNameToPath[info.name] = p
			}
		}
	}

	// Determine entrypoints: if no script has isMain, mark scripts with no incoming extends/preload
	hasMain := false
	for _, info := range scripts {
		if info.isMain {
			hasMain = true
			break
		}
	}
	if !hasMain {
		incoming := make(map[string]int)
		for _, info := range scripts {
			for _, dep := range info.deps {
				if target := resolveGDPath(dep, scripts); target != "" {
					incoming[target]++
				}
			}
			if info.extends != "" {
				if extPath, ok := classNameToPath[info.extends]; ok {
					incoming[extPath]++
				}
			}
		}
		for p, info := range scripts {
			if incoming[p] == 0 {
				info.isMain = true
			}
		}
	}

	// Build package nodes
	nodes := []Node{}
	for _, info := range scripts {
		nodeType := "package"
		if info.isMain {
			nodeType = "entrypoint"
		}
		nodes = append(nodes, Node{
			ID:        sanitizeID(info.path),
			Label:     info.name,
			Package:   info.path,
			Functions: info.funcs,
			Structs:   info.structs,
			Type:      nodeType,
			Position:  map[string]float64{"x": 0, "y": 0},
		})
	}

	// Build edges from preloads and extends
	edges := []Edge{}
	edgeSet := make(map[string]bool)
	edgeIdx := 0

	for _, info := range scripts {
		for _, dep := range info.deps {
			targetPath := resolveGDPath(dep, scripts)
			if targetPath == "" {
				continue
			}
			srcID := sanitizeID(info.path)
			tgtID := sanitizeID(targetPath)
			key := srcID + "->" + tgtID
			if !edgeSet[key] {
				edgeSet[key] = true
				edges = append(edges, Edge{
					ID:     fmt.Sprintf("e%d", edgeIdx),
					Source: srcID,
					Target: tgtID,
					Label:  "preload",
				})
				edgeIdx++
			}
		}
		if info.extends != "" {
			if extPath, ok := classNameToPath[info.extends]; ok {
				srcID := sanitizeID(info.path)
				tgtID := sanitizeID(extPath)
				key := srcID + "->extends->" + tgtID
				if !edgeSet[key] {
					edgeSet[key] = true
					edges = append(edges, Edge{
						ID:     fmt.Sprintf("e%d", edgeIdx),
						Source: srcID,
						Target: tgtID,
						Label:  "extends",
					})
					edgeIdx++
				}
			}
		}
	}

	// Build struct nodes from inner classes
	structNodes := []StructNode{}
	for _, info := range scripts {
		for _, s := range info.structs {
			structNodes = append(structNodes, StructNode{
				ID:       sanitizeID(info.path + "." + s.Name),
				Label:    s.Name,
				Package:  info.path,
				Fields:   s.Fields,
				Position: map[string]float64{"x": 0, "y": 0},
			})
		}
	}

	funcNodes, funcEdges := buildGDFunctionGraph(scripts)

	graph := &Graph{
		Language:      "gdscript",
		Nodes:         nodes,
		Edges:         edges,
		FunctionNodes: funcNodes,
		FunctionEdges: funcEdges,
		StructNodes:   structNodes,
		StructEdges:   []StructEdge{},
	}

	applyLayout(graph)
	applyFuncLayout(graph.FunctionNodes, graph.FunctionEdges)
	applyStructLayout(graph)

	return graph, nil
}

func resolveGDPath(resPath string, scripts map[string]*gdScriptInfo) string {
	rel := strings.TrimPrefix(resPath, "res://")
	for p := range scripts {
		norm := filepath.ToSlash(p)
		if strings.HasSuffix(norm, "/"+rel) || strings.HasSuffix(norm, rel) {
			return p
		}
		if filepath.Base(p) == filepath.Base(rel) {
			return p
		}
	}
	return ""
}

func parseGDScriptFile(path string) (*gdScriptInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	stem := strings.TrimSuffix(filepath.Base(path), ".gd")
	info := &gdScriptInfo{
		path:     path,
		name:     stem,
		preloads: make(map[string]string),
	}

	lower := strings.ToLower(stem)
	if lower == "main" || lower == "game" || lower == "app" || lower == "autoload" || lower == "global" {
		info.isMain = true
	}

	lines := []string{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	type funcState struct {
		baseIndent int
		funcIdx    int
		bodyLines  []string
	}

	var curFunc *funcState

	flushFunc := func() {
		if curFunc == nil {
			return
		}
		body := strings.Join(curFunc.bodyLines, "\n")
		info.funcs[curFunc.funcIdx].Body = body
		calls, ops := extractGDCalls(curFunc.bodyLines, info.preloads)
		info.funcs[curFunc.funcIdx].CallsTo = calls
		info.funcs[curFunc.funcIdx].DataOps = ops
		curFunc = nil
	}

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Blank lines and comments accumulate into function body
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			if curFunc != nil {
				curFunc.bodyLines = append(curFunc.bodyLines, line)
			}
			continue
		}

		indent := len(line) - len(strings.TrimLeft(line, "\t "))

		// If we've dedented past the current function, close it
		if curFunc != nil && indent <= curFunc.baseIndent {
			flushFunc()
		}

		// extends
		if m := reGDExtends.FindStringSubmatch(trimmed); m != nil && indent == 0 {
			info.extends = strings.TrimSpace(m[1])
			if info.extends == "SceneTree" || info.extends == "MainLoop" {
				info.isMain = true
			}
			continue
		}

		// class_name
		if m := reGDClassName.FindStringSubmatch(trimmed); m != nil && indent == 0 {
			info.name = m[1]
			continue
		}

		// signal (only at top level)
		if m := reGDSignal.FindStringSubmatch(trimmed); m != nil && indent == 0 {
			params := parseParams(m[2])
			info.funcs = append(info.funcs, FunctionInfo{
				Name:    "signal:" + m[1],
				Params:  params,
				Returns: []string{},
				DataOps: []string{},
				CallsTo: []string{},
				Body:    "",
			})
			continue
		}

		// preload variable assignment (e.g. var Enemy = preload("res://..."))
		if m := reGDPreload.FindStringSubmatch(trimmed); m != nil {
			resPath := m[1]
			info.deps = append(info.deps, resPath)
			// Extract var name: look for "var <name>" before "="
			if eqIdx := strings.Index(trimmed, "="); eqIdx > 0 {
				lhs := strings.TrimSpace(trimmed[:eqIdx])
				parts := strings.Fields(lhs)
				varName := ""
				for j, p := range parts {
					if p == "var" && j+1 < len(parts) {
						varName = strings.TrimSuffix(strings.TrimSuffix(parts[j+1], ":"), " ")
						if colonIdx := strings.IndexByte(varName, ':'); colonIdx != -1 {
							varName = varName[:colonIdx]
						}
						break
					}
				}
				if varName != "" {
					info.preloads[varName] = resPath
				}
			}
		}

		// inner class (only at top level)
		if m := reGDInnerClass.FindStringSubmatch(line); m != nil && indent == 0 {
			className := m[2]
			fields := extractInnerClassFields(lines, i+1, 1)
			info.structs = append(info.structs, StructInfo{
				Name:   className,
				Fields: fields,
			})
			// Don't continue; inner class body will be parsed below
		}

		// func declaration
		if m := reGDFunc.FindStringSubmatch(line); m != nil {
			flushFunc() // close any open function first

			funcBaseIndent := len(m[1])
			funcName := m[2]
			params := parseParams(m[3])
			returns := []string{}
			if m[4] != "" {
				returns = []string{strings.TrimSuffix(m[4], ":")}
			}

			info.funcs = append(info.funcs, FunctionInfo{
				Name:    funcName,
				Params:  params,
				Returns: returns,
				CallsTo: []string{},
				DataOps: []string{},
				Body:    "",
			})
			curFunc = &funcState{
				baseIndent: funcBaseIndent,
				funcIdx:    len(info.funcs) - 1,
			}
			continue
		}

		// Accumulate into current function body
		if curFunc != nil {
			curFunc.bodyLines = append(curFunc.bodyLines, line)
		}
	}

	flushFunc()
	return info, nil
}

func parseParams(raw string) []string {
	params := []string{}
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return params
	}
	for _, p := range strings.Split(raw, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			params = append(params, p)
		}
	}
	return params
}

func extractInnerClassFields(lines []string, start, minIndent int) []string {
	fields := []string{}
	for i := start; i < len(lines) && i < start+80; i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		lineIndent := len(line) - len(strings.TrimLeft(line, "\t "))
		if lineIndent < minIndent {
			break
		}
		// Only pick up var declarations inside the class
		if strings.HasPrefix(trimmed, "func ") {
			break
		}
		if m := reGDVar.FindStringSubmatch(trimmed); m != nil {
			field := m[1]
			if m[2] != "" {
				field += ": " + strings.TrimSpace(m[2])
			}
			fields = append(fields, field)
		}
	}
	return fields
}

func extractGDCalls(bodyLines []string, preloads map[string]string) (calls []string, ops []string) {
	callSet := make(map[string]bool)
	opSet := make(map[string]bool)

	for _, line := range bodyLines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Data op detection
		if strings.Contains(trimmed, "for ") && strings.Contains(trimmed, " in ") {
			opSet["iterate"] = true
		}
		if strings.HasPrefix(trimmed, "if ") || strings.Contains(trimmed, "\tif ") {
			opSet["filter"] = true
		}
		if strings.Contains(trimmed, ".filter(") || strings.Contains(trimmed, ".map(") {
			opSet["transform"] = true
		}
		if strings.Contains(trimmed, ".append(") || strings.Contains(trimmed, ".push_back(") ||
			strings.Contains(trimmed, ".push_front(") {
			opSet["merge"] = true
		}
		if strings.Contains(trimmed, ".duplicate(") || strings.Contains(trimmed, "copy(") {
			opSet["copy"] = true
		}

		// Cross-script calls via preloaded variable
		for varName, resPath := range preloads {
			if strings.Contains(trimmed, varName+".") || strings.Contains(trimmed, varName+"(") {
				depStem := strings.TrimSuffix(filepath.Base(resPath), ".gd")
				if !callSet[depStem] {
					calls = append(calls, depStem)
					callSet[depStem] = true
				}
			}
		}
	}

	for op := range opSet {
		ops = append(ops, op)
	}
	return
}

func buildGDFunctionGraph(scripts map[string]*gdScriptInfo) ([]FuncNode, []FuncEdge) {
	funcNodes := []FuncNode{}
	funcEdges := []FuncEdge{}

	// Map path -> funcName -> nodeID for edge building
	localIndex := make(map[string]map[string]string)

	for _, info := range scripts {
		localIndex[info.path] = make(map[string]string)
		for _, fn := range info.funcs {
			if strings.HasPrefix(fn.Name, "signal:") {
				continue
			}
			id := sanitizeID(info.path + "." + fn.Name)

			isEntryFunc := fn.Name == "_ready" || fn.Name == "_init" ||
				fn.Name == "_start" || fn.Name == "main"

			node := FuncNode{
				ID:      id,
				Label:   fn.Name,
				Package: info.path,
				Params:  fn.Params,
				Returns: fn.Returns,
				Body:    fn.Body,
				Missing: false,
				Position: map[string]float64{"x": 0, "y": 0},
			}
			if isEntryFunc {
				// Mark with Missing=false (already default); label stays as-is
				// The FunctionNode component treats label=="main" as blue
				_ = isEntryFunc
			}

			funcNodes = append(funcNodes, node)
			localIndex[info.path][fn.Name] = id
		}
	}

	// Build intra-script call edges
	edgeSet := make(map[string]bool)
	for _, info := range scripts {
		for _, fn := range info.funcs {
			if strings.HasPrefix(fn.Name, "signal:") {
				continue
			}
			srcID := sanitizeID(info.path + "." + fn.Name)

			bodyLines := strings.Split(fn.Body, "\n")
			for _, line := range bodyLines {
				trimmed := strings.TrimSpace(line)
				if strings.HasPrefix(trimmed, "#") {
					continue
				}
				matches := reGDCallSimple.FindAllStringSubmatch(trimmed, -1)
				for _, m := range matches {
					callee := m[1]
					if gdscriptBuiltins[callee] || callee == fn.Name {
						continue
					}
					if tgtID, ok := localIndex[info.path][callee]; ok && tgtID != srcID {
						key := srcID + "->" + tgtID
						if !edgeSet[key] {
							edgeSet[key] = true
							funcEdges = append(funcEdges, FuncEdge{
								ID:     sanitizeID(key),
								Source: srcID,
								Target: tgtID,
								Label:  callee + "()",
							})
						}
					}
				}
			}
		}
	}

	return funcNodes, funcEdges
}
