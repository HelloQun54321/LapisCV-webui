// Windows 自动分配的端口偶尔会命中 Fetch / 浏览器禁用端口；重新分配测试端口。
export async function listenForBrowser(server) {
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const url = 'http://127.0.0.1:' + server.address().port
    try { await fetch(url + '/api/health', { signal: AbortSignal.timeout(3000) }); return url }
    catch (error) {
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
      if (error.cause?.message !== 'bad port') throw error
    }
  }
  throw new Error('无法分配浏览器可用的本地测试端口')
}
