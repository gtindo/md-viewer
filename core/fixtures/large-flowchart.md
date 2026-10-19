# Large flowchart (300 nodes)

A generated stress fixture: 300 nodes in 12 subgraphs, ~420 edges.

```mermaid
flowchart LR
  subgraph S0["Stage 0: index"]
    N0("node 0<br/>log_0")
    N1["node 1<br/>tenant_1"]
    N2["node 2<br/>metric_2"]
    N3["node 3<br/>batch_3"]
    N4("node 4<br/>tenant_4")
    N5["node 5<br/>log_5"]
    N6[("node 6<br/>tenant_6")]
    N7("node 7<br/>tenant_7")
    N8[("node 8<br/>tenant_8")]
    N9["node 9<br/>span_9"]
    N10["node 10<br/>batch_10"]
    N11[("node 11<br/>tenant_11")]
    N12("node 12<br/>tenant_12")
    N13("node 13<br/>metric_13")
    N14[("node 14<br/>span_14")]
    N15["node 15<br/>batch_15"]
    N16{"node 16<br/>batch_16"}
    N17("node 17<br/>tenant_0")
    N18("node 18<br/>metric_1")
    N19["node 19<br/>batch_2"]
    N20["node 20<br/>batch_3"]
    N21["node 21<br/>batch_4"]
    N22("node 22<br/>log_5")
    N23[("node 23<br/>metric_6")]
    N24[("node 24<br/>batch_7")]
  end
  subgraph S1["Stage 1: export"]
    N25{"node 25<br/>metric_8"}
    N26("node 26<br/>span_9")
    N27("node 27<br/>tenant_10")
    N28{"node 28<br/>batch_11"}
    N29[("node 29<br/>metric_12")]
    N30[("node 30<br/>metric_13")]
    N31["node 31<br/>tenant_14"]
    N32[("node 32<br/>span_15")]
    N33{"node 33<br/>span_16"}
    N34[("node 34<br/>log_0")]
    N35["node 35<br/>block_1"]
    N36["node 36<br/>batch_2"]
    N37{"node 37<br/>metric_3"}
    N38{"node 38<br/>batch_4"}
    N39[("node 39<br/>batch_5")]
    N40[("node 40<br/>tenant_6")]
    N41["node 41<br/>metric_7"]
    N42[("node 42<br/>block_8")]
    N43["node 43<br/>tenant_9"]
    N44{"node 44<br/>block_10"}
    N45[("node 45<br/>metric_11")]
    N46[("node 46<br/>block_12")]
    N47{"node 47<br/>tenant_13"}
    N48[("node 48<br/>metric_14")]
    N49("node 49<br/>batch_15")
  end
  subgraph S2["Stage 2: parse"]
    N50[("node 50<br/>tenant_16")]
    N51("node 51<br/>metric_0")
    N52("node 52<br/>block_1")
    N53("node 53<br/>log_2")
    N54[("node 54<br/>log_3")]
    N55["node 55<br/>span_4"]
    N56[("node 56<br/>log_5")]
    N57{"node 57<br/>span_6"}
    N58[("node 58<br/>batch_7")]
    N59{"node 59<br/>block_8"}
    N60[("node 60<br/>metric_9")]
    N61[("node 61<br/>span_10")]
    N62("node 62<br/>tenant_11")
    N63("node 63<br/>span_12")
    N64("node 64<br/>block_13")
    N65("node 65<br/>tenant_14")
    N66[("node 66<br/>batch_15")]
    N67("node 67<br/>metric_16")
    N68{"node 68<br/>tenant_0"}
    N69("node 69<br/>log_1")
    N70{"node 70<br/>batch_2"}
    N71{"node 71<br/>span_3"}
    N72["node 72<br/>log_4"]
    N73[("node 73<br/>log_5")]
    N74[("node 74<br/>log_6")]
  end
  subgraph S3["Stage 3: parse"]
    N75[("node 75<br/>block_7")]
    N76[("node 76<br/>tenant_8")]
    N77("node 77<br/>tenant_9")
    N78("node 78<br/>log_10")
    N79("node 79<br/>tenant_11")
    N80{"node 80<br/>batch_12"}
    N81["node 81<br/>tenant_13"]
    N82["node 82<br/>batch_14"]
    N83("node 83<br/>batch_15")
    N84["node 84<br/>metric_16"]
    N85["node 85<br/>tenant_0"]
    N86("node 86<br/>batch_1")
    N87[("node 87<br/>span_2")]
    N88{"node 88<br/>metric_3"}
    N89{"node 89<br/>log_4"}
    N90["node 90<br/>tenant_5"]
    N91[("node 91<br/>log_6")]
    N92[("node 92<br/>log_7")]
    N93{"node 93<br/>tenant_8"}
    N94("node 94<br/>tenant_9")
    N95{"node 95<br/>block_10"}
    N96{"node 96<br/>log_11"}
    N97("node 97<br/>batch_12")
    N98["node 98<br/>span_13"]
    N99{"node 99<br/>span_14"}
  end
  subgraph S4["Stage 4: ingest"]
    N100{"node 100<br/>block_15"}
    N101["node 101<br/>block_16"]
    N102{"node 102<br/>batch_0"}
    N103{"node 103<br/>span_1"}
    N104{"node 104<br/>span_2"}
    N105{"node 105<br/>block_3"}
    N106("node 106<br/>batch_4")
    N107("node 107<br/>span_5")
    N108[("node 108<br/>block_6")]
    N109("node 109<br/>span_7")
    N110[("node 110<br/>metric_8")]
    N111["node 111<br/>tenant_9"]
    N112{"node 112<br/>log_10"}
    N113{"node 113<br/>span_11"}
    N114{"node 114<br/>log_12"}
    N115{"node 115<br/>metric_13"}
    N116["node 116<br/>span_14"]
    N117["node 117<br/>span_15"]
    N118[("node 118<br/>span_16")]
    N119{"node 119<br/>span_0"}
    N120[("node 120<br/>batch_1")]
    N121["node 121<br/>log_2"]
    N122{"node 122<br/>block_3"}
    N123["node 123<br/>block_4"]
    N124["node 124<br/>log_5"]
  end
  subgraph S5["Stage 5: store"]
    N125[("node 125<br/>span_6")]
    N126[("node 126<br/>block_7")]
    N127{"node 127<br/>tenant_8"}
    N128[("node 128<br/>log_9")]
    N129[("node 129<br/>block_10")]
    N130["node 130<br/>block_11"]
    N131("node 131<br/>span_12")
    N132("node 132<br/>tenant_13")
    N133("node 133<br/>batch_14")
    N134[("node 134<br/>block_15")]
    N135("node 135<br/>batch_16")
    N136[("node 136<br/>block_0")]
    N137{"node 137<br/>span_1"}
    N138("node 138<br/>tenant_2")
    N139["node 139<br/>block_3"]
    N140["node 140<br/>batch_4"]
    N141("node 141<br/>log_5")
    N142("node 142<br/>span_6")
    N143["node 143<br/>metric_7"]
    N144("node 144<br/>metric_8")
    N145("node 145<br/>batch_9")
    N146{"node 146<br/>metric_10"}
    N147[("node 147<br/>span_11")]
    N148["node 148<br/>block_12"]
    N149{"node 149<br/>log_13"}
  end
  subgraph S6["Stage 6: compact"]
    N150("node 150<br/>batch_14")
    N151("node 151<br/>batch_15")
    N152["node 152<br/>log_16"]
    N153("node 153<br/>batch_0")
    N154["node 154<br/>span_1"]
    N155("node 155<br/>span_2")
    N156[("node 156<br/>batch_3")]
    N157["node 157<br/>batch_4"]
    N158["node 158<br/>metric_5"]
    N159[("node 159<br/>tenant_6")]
    N160["node 160<br/>span_7"]
    N161("node 161<br/>metric_8")
    N162["node 162<br/>tenant_9"]
    N163[("node 163<br/>batch_10")]
    N164["node 164<br/>tenant_11"]
    N165[("node 165<br/>metric_12")]
    N166("node 166<br/>block_13")
    N167{"node 167<br/>log_14"}
    N168[("node 168<br/>batch_15")]
    N169("node 169<br/>block_16")
    N170{"node 170<br/>batch_0"}
    N171("node 171<br/>log_1")
    N172("node 172<br/>log_2")
    N173["node 173<br/>log_3"]
    N174[("node 174<br/>metric_4")]
  end
  subgraph S7["Stage 7: parse"]
    N175("node 175<br/>log_5")
    N176["node 176<br/>span_6"]
    N177{"node 177<br/>tenant_7"}
    N178("node 178<br/>block_8")
    N179{"node 179<br/>span_9"}
    N180{"node 180<br/>span_10"}
    N181[("node 181<br/>span_11")]
    N182["node 182<br/>log_12"]
    N183[("node 183<br/>span_13")]
    N184("node 184<br/>span_14")
    N185[("node 185<br/>batch_15")]
    N186[("node 186<br/>metric_16")]
    N187[("node 187<br/>span_0")]
    N188{"node 188<br/>metric_1"}
    N189["node 189<br/>block_2"]
    N190{"node 190<br/>tenant_3"}
    N191{"node 191<br/>batch_4"}
    N192[("node 192<br/>log_5")]
    N193["node 193<br/>log_6"]
    N194{"node 194<br/>batch_7"}
    N195{"node 195<br/>batch_8"}
    N196["node 196<br/>tenant_9"]
    N197("node 197<br/>tenant_10")
    N198["node 198<br/>metric_11"]
    N199{"node 199<br/>tenant_12"}
  end
  subgraph S8["Stage 8: route"]
    N200{"node 200<br/>span_13"}
    N201[("node 201<br/>block_14")]
    N202{"node 202<br/>log_15"}
    N203("node 203<br/>batch_16")
    N204[("node 204<br/>block_0")]
    N205{"node 205<br/>tenant_1"}
    N206{"node 206<br/>tenant_2"}
    N207("node 207<br/>log_3")
    N208["node 208<br/>metric_4"]
    N209["node 209<br/>block_5"]
    N210["node 210<br/>metric_6"]
    N211["node 211<br/>batch_7"]
    N212("node 212<br/>tenant_8")
    N213{"node 213<br/>tenant_9"}
    N214[("node 214<br/>tenant_10")]
    N215{"node 215<br/>batch_11"}
    N216[("node 216<br/>metric_12")]
    N217("node 217<br/>tenant_13")
    N218("node 218<br/>tenant_14")
    N219("node 219<br/>metric_15")
    N220["node 220<br/>span_16"]
    N221("node 221<br/>metric_0")
    N222{"node 222<br/>batch_1"}
    N223("node 223<br/>metric_2")
    N224[("node 224<br/>batch_3")]
  end
  subgraph S9["Stage 9: route"]
    N225{"node 225<br/>metric_4"}
    N226["node 226<br/>metric_5"]
    N227["node 227<br/>tenant_6"]
    N228["node 228<br/>block_7"]
    N229("node 229<br/>batch_8")
    N230[("node 230<br/>span_9")]
    N231[("node 231<br/>tenant_10")]
    N232[("node 232<br/>block_11")]
    N233[("node 233<br/>batch_12")]
    N234[("node 234<br/>batch_13")]
    N235{"node 235<br/>block_14"}
    N236("node 236<br/>span_15")
    N237{"node 237<br/>span_16"}
    N238("node 238<br/>log_0")
    N239{"node 239<br/>tenant_1"}
    N240("node 240<br/>tenant_2")
    N241["node 241<br/>block_3"]
    N242{"node 242<br/>log_4"}
    N243("node 243<br/>tenant_5")
    N244["node 244<br/>block_6"]
    N245[("node 245<br/>batch_7")]
    N246{"node 246<br/>batch_8"}
    N247("node 247<br/>block_9")
    N248{"node 248<br/>tenant_10"}
    N249[("node 249<br/>span_11")]
  end
  subgraph S10["Stage 10: route"]
    N250{"node 250<br/>log_12"}
    N251["node 251<br/>metric_13"]
    N252{"node 252<br/>metric_14"}
    N253{"node 253<br/>span_15"}
    N254["node 254<br/>metric_16"]
    N255("node 255<br/>metric_0")
    N256("node 256<br/>tenant_1")
    N257{"node 257<br/>log_2"}
    N258["node 258<br/>log_3"]
    N259{"node 259<br/>batch_4"}
    N260("node 260<br/>span_5")
    N261["node 261<br/>tenant_6"]
    N262{"node 262<br/>tenant_7"}
    N263("node 263<br/>log_8")
    N264["node 264<br/>log_9"]
    N265["node 265<br/>metric_10"]
    N266{"node 266<br/>block_11"}
    N267("node 267<br/>tenant_12")
    N268("node 268<br/>block_13")
    N269[("node 269<br/>metric_14")]
    N270[("node 270<br/>span_15")]
    N271{"node 271<br/>block_16"}
    N272("node 272<br/>tenant_0")
    N273[("node 273<br/>block_1")]
    N274("node 274<br/>batch_2")
  end
  subgraph S11["Stage 11: ingest"]
    N275("node 275<br/>tenant_3")
    N276["node 276<br/>tenant_4"]
    N277("node 277<br/>block_5")
    N278{"node 278<br/>tenant_6"}
    N279[("node 279<br/>log_7")]
    N280["node 280<br/>block_8"]
    N281["node 281<br/>block_9"]
    N282("node 282<br/>log_10")
    N283{"node 283<br/>tenant_11"}
    N284[("node 284<br/>tenant_12")]
    N285["node 285<br/>block_13"]
    N286["node 286<br/>block_14"]
    N287[("node 287<br/>metric_15")]
    N288["node 288<br/>metric_16"]
    N289("node 289<br/>block_0")
    N290("node 290<br/>span_1")
    N291[("node 291<br/>log_2")]
    N292[("node 292<br/>tenant_3")]
    N293[("node 293<br/>block_4")]
    N294{"node 294<br/>tenant_5"}
    N295("node 295<br/>tenant_6")
    N296("node 296<br/>metric_7")
    N297{"node 297<br/>block_8"}
    N298{"node 298<br/>batch_9"}
    N299("node 299<br/>tenant_10")
  end
  N0 --> N1
  N0 --> N2
  N0 --> N5
  N0 --> N21
  N1 --> N3
  N1 --> N7
  N1 --> N250
  N2 --> N4
  N2 --> N19
  N2 --> N24
  N3 --> N16
  N3 --> N54
  N3 --> N222
  N4 --> N9
  N4 --> N11
  N5 --> N6
  N5 --> N33
  N5 --> N275
  N6 --> N17
  N6 --> N29
  N7 --> N8
  N7 --> N12
  N7 --> N13
  N7 --> N14
  N7 --> N26
  N7 --> N35
  N8 --> N10
  N8 --> N27
  N8 --> N32
  N9 --> N18
  N9 --> N22
  N9 --> N186
  N10 --> N36
  N11 --> N99
  N12 --> N15
  N12 --> N28
  N12 --> N72
  N13 --> N33
  N14 --> N23
  N14 --> N26
  N14 --> N210
  N15 --> N20
  N15 --> N41
  N16 --> N25
  N17 --> N39
  N17 --> N113
  N18 --> N101
  N19 --> N188
  N20 --> N66
  N20 --> N150
  N21 --> N40
  N21 --> N48
  N22 --> N34
  N22 --> N104
  N22 --> N134
  N24 --> N38
  N24 --> N46
  N24 --> N67
  N24 --> N151
  N24 --> N184
  N25 --> N97
  N26 --> N159
  N27 --> N57
  N27 --> N109
  N27 --> N198
  N27 --> N258
  N28 --> N51
  N29 --> N30
  N29 --> N59
  N30 --> N31
  N30 --> N37
  N30 --> N94
  N31 --> N42
  N31 --> N45
  N31 --> N50
  N31 --> N131
  N32 --> N74
  N33 --> N58
  N33 --> N202
  N34 --> N44
  N34 --> N55
  N34 --> N65
  N34 --> N105
  N37 --> N52
  N38 --> N56
  N38 --> N190
  N39 --> N43
  N40 --> N55
  N40 --> N66
  N40 --> N84
  N40 --> N143
  N41 --> N49
  N41 --> N131
  N41 --> N179
  N41 --> N226
  N42 --> N160
  N43 --> N64
  N44 --> N71
  N44 --> N74
  N44 --> N82
  N45 --> N47
  N45 --> N60
  N45 --> N63
  N46 --> N62
  N46 --> N83
  N49 --> N68
  N50 --> N67
  N50 --> N70
  N51 --> N53
  N51 --> N69
  N52 --> N54
  N52 --> N61
  N53 --> N73
  N53 --> N80
  N53 --> N129
  N54 --> N84
  N55 --> N75
  N56 --> N99
  N57 --> N77
  N58 --> N65
  N58 --> N82
  N58 --> N271
  N61 --> N79
  N62 --> N90
  N62 --> N150
  N66 --> N87
  N66 --> N88
  N67 --> N95
  N67 --> N251
  N67 --> N254
  N68 --> N72
  N70 --> N76
  N70 --> N89
  N73 --> N91
  N73 --> N102
  N73 --> N130
  N74 --> N78
  N74 --> N92
  N74 --> N178
  N74 --> N201
  N75 --> N83
  N76 --> N105
  N76 --> N126
  N76 --> N148
  N77 --> N96
  N77 --> N104
  N78 --> N100
  N79 --> N86
  N79 --> N273
  N80 --> N81
  N80 --> N196
  N80 --> N216
  N81 --> N98
  N81 --> N103
  N81 --> N165
  N82 --> N94
  N82 --> N142
  N82 --> N218
  N83 --> N85
  N85 --> N111
  N86 --> N135
  N87 --> N108
  N89 --> N112
  N90 --> N93
  N91 --> N113
  N91 --> N242
  N93 --> N99
  N93 --> N117
  N93 --> N123
  N93 --> N206
  N93 --> N289
  N94 --> N268
  N95 --> N125
  N96 --> N97
  N96 --> N116
  N96 --> N167
  N97 --> N114
  N98 --> N101
  N98 --> N107
  N99 --> N109
  N100 --> N119
  N100 --> N200
  N100 --> N242
  N101 --> N115
  N101 --> N154
  N102 --> N106
  N104 --> N121
  N104 --> N187
  N106 --> N134
  N106 --> N135
  N108 --> N132
  N109 --> N110
  N109 --> N127
  N112 --> N118
  N113 --> N135
  N113 --> N207
  N114 --> N248
  N115 --> N120
  N116 --> N126
  N116 --> N142
  N116 --> N217
  N117 --> N130
  N118 --> N131
  N118 --> N147
  N118 --> N238
  N119 --> N124
  N119 --> N125
  N120 --> N122
  N120 --> N167
  N120 --> N275
  N121 --> N138
  N123 --> N139
  N124 --> N145
  N124 --> N243
  N125 --> N151
  N126 --> N133
  N126 --> N208
  N127 --> N128
  N127 --> N129
  N127 --> N152
  N128 --> N270
  N129 --> N140
  N130 --> N137
  N131 --> N146
  N133 --> N143
  N135 --> N136
  N135 --> N141
  N135 --> N155
  N135 --> N156
  N136 --> N157
  N136 --> N158
  N137 --> N150
  N137 --> N154
  N138 --> N153
  N138 --> N205
  N139 --> N171
  N140 --> N162
  N140 --> N233
  N141 --> N144
  N142 --> N161
  N142 --> N165
  N144 --> N171
  N144 --> N296
  N145 --> N163
  N145 --> N166
  N147 --> N148
  N147 --> N172
  N147 --> N175
  N148 --> N149
  N149 --> N174
  N149 --> N258
  N151 --> N161
  N152 --> N159
  N152 --> N167
  N152 --> N170
  N152 --> N176
  N153 --> N160
  N153 --> N268
  N154 --> N164
  N154 --> N235
  N155 --> N168
  N157 --> N213
  N158 --> N221
  N158 --> N299
  N159 --> N182
  N159 --> N193
  N160 --> N169
  N163 --> N173
  N163 --> N177
  N163 --> N189
  N163 --> N190
  N163 --> N235
  N165 --> N180
  N165 --> N185
  N165 --> N186
  N165 --> N193
  N167 --> N183
  N167 --> N191
  N167 --> N192
  N167 --> N209
  N168 --> N181
  N169 --> N192
  N169 --> N194
  N169 --> N197
  N171 --> N187
  N171 --> N188
  N173 --> N185
  N173 --> N215
  N174 --> N179
  N175 --> N195
  N176 --> N178
  N176 --> N199
  N176 --> N206
  N177 --> N190
  N178 --> N198
  N179 --> N201
  N180 --> N186
  N180 --> N204
  N181 --> N200
  N183 --> N184
  N183 --> N196
  N183 --> N220
  N185 --> N202
  N186 --> N235
  N188 --> N228
  N190 --> N214
  N190 --> N219
  N190 --> N277
  N191 --> N203
  N192 --> N209
  N192 --> N210
  N194 --> N211
  N194 --> N216
  N196 --> N251
  N197 --> N202
  N197 --> N215
  N197 --> N217
  N198 --> N224
  N199 --> N213
  N199 --> N221
  N199 --> N233
  N200 --> N207
  N201 --> N230
  N202 --> N281
  N203 --> N205
  N204 --> N223
  N204 --> N265
  N205 --> N208
  N205 --> N212
  N205 --> N220
  N205 --> N233
  N207 --> N295
  N208 --> N232
  N210 --> N222
  N211 --> N298
  N212 --> N213
  N212 --> N218
  N212 --> N226
  N212 --> N234
  N213 --> N227
  N213 --> N235
  N213 --> N236
  N215 --> N255
  N216 --> N225
  N216 --> N246
  N218 --> N228
  N219 --> N237
  N219 --> N248
  N220 --> N238
  N220 --> N252
  N221 --> N242
  N221 --> N247
  N224 --> N229
  N224 --> N240
  N224 --> N241
  N226 --> N258
  N227 --> N230
  N227 --> N257
  N228 --> N231
  N228 --> N234
  N229 --> N239
  N230 --> N258
  N231 --> N284
  N232 --> N249
  N233 --> N235
  N239 --> N254
  N240 --> N243
  N240 --> N244
  N241 --> N256
  N241 --> N259
  N242 --> N245
  N242 --> N250
  N243 --> N255
  N243 --> N270
  N245 --> N251
  N245 --> N268
  N246 --> N272
  N246 --> N282
  N247 --> N273
  N248 --> N253
  N248 --> N271
  N249 --> N276
  N250 --> N252
  N250 --> N264
  N250 --> N266
  N251 --> N267
  N253 --> N280
  N257 --> N285
  N259 --> N260
  N259 --> N263
  N259 --> N269
  N259 --> N288
  N259 --> N289
  N260 --> N261
  N260 --> N274
  N261 --> N262
  N262 --> N265
  N264 --> N269
  N265 --> N291
  N266 --> N275
  N266 --> N295
  N266 --> N296
  N268 --> N284
  N269 --> N292
  N270 --> N280
  N271 --> N278
  N271 --> N279
  N273 --> N277
  N273 --> N286
  N273 --> N299
  N276 --> N282
  N277 --> N298
  N278 --> N281
  N281 --> N283
  N281 --> N287
  N281 --> N293
  N285 --> N290
  N286 --> N296
  N289 --> N297
  N293 --> N294
```
