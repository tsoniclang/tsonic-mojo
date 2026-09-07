async def consume(values: List[Int]):
    async for value in values:
        _ = value
