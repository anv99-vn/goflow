package main

func sum3(a int, b int, c int) int {
	return sum(a, sum(b, c))
}