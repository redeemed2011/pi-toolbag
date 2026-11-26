package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: fallback-kernel classify|decide")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "classify":
		var err failoverError
		if decode(&err) {
			return
		}
		fmt.Println(classifyError(err))
	case "decide":
		var input decideInput
		if decode(&input) {
			return
		}
		raw, err := json.Marshal(decideFailover(input))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Println(string(raw))
	default:
		fmt.Fprintln(os.Stderr, "usage: fallback-kernel classify|decide")
		os.Exit(2)
	}
}

func decode(dest any) bool {
	if err := json.NewDecoder(os.Stdin).Decode(dest); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
		return true
	}
	return false
}
