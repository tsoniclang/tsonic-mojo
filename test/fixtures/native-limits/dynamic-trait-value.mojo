trait Counter:
    fn next(self) -> Int:
        ...


fn invoke(value: Counter) -> Int:
    return value.next()
