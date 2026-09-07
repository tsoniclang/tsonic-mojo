trait Counter:
    def next(self) -> Int:
        ...


def invoke(value: Counter) -> Int:
    return value.next()
